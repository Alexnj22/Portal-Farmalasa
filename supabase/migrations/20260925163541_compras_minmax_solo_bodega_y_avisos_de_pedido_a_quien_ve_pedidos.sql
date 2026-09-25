SET lock_timeout = '5s';

-- Tres ajustes de quién recibe y quién decide, pedidos por el usuario el
-- 2026-09-25 al revisar el listado de avisos por cargo.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · Jefe/a de Compras: Mín·Máx de Bodega y desde el pedido; nunca decide
-- ══════════════════════════════════════════════════════════════════════════
--
-- «Solo debe poder las de bodega y si las modifica desde el pedido, pero no
-- aprobar / rechazar modificaciones.» Tenía `requests_minmax.can_approve` con
-- `can_view` apagado —aprobaba sin poder ver— y por eso le llegaban los 50
-- avisos del mes. Y `minmax` con alcance ALL: editaba las siete salas desde el
-- módulo.
--
-- Con alcance BRANCH el módulo se abre fijo en su sala (`MinMaxView`) y la
-- policy `psp_update` sólo le deja escribir filas de la sucursal 6. Lo que
-- corrige desde un pedido va por `guardar_minmax_desde_pedido`, abajo.
UPDATE public.role_permissions rp
   SET can_approve = false, updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id AND r.name = 'Jefe/a de Compras y Logistica'
   AND rp.module_key IN ('requests_minmax', 'minmax');

UPDATE public.role_permissions rp
   SET scope = 'BRANCH', updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id AND r.name = 'Jefe/a de Compras y Logistica'
   AND rp.module_key = 'minmax';

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · Guardar MIN·MAX desde un pedido
-- ══════════════════════════════════════════════════════════════════════════
--
-- El renglón de revisión del pedido escribía `product_stock_params` con un
-- UPDATE directo, o sea bajo `psp_update`: con alcance de una sala, corregir el
-- MAX de otra desde su pedido devolvía CERO filas sin error y la pantalla
-- mostraba «guardado». Ésta es la puerta de ese caso: pide edición de Mín·Máx
-- (cualquier alcance) y que el producto esté EN ese pedido para esa sala — es
-- el pedido lo que autoriza tocar la fila, no el alcance del módulo.
CREATE OR REPLACE FUNCTION public.guardar_minmax_desde_pedido(
    p_pedido_item_id integer,
    p_min integer,
    p_max integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    it  public.pedido_items%ROWTYPE;
    v_n integer;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['minmax'])) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
    END IF;

    IF public.auth_module_locked(ARRAY['minmax','pedidos']) THEN
        RAISE EXCEPTION 'MODULE_LOCKED: Min/Max está en mantenimiento';
    END IF;

    SELECT * INTO it FROM public.pedido_items WHERE id = p_pedido_item_id;
    IF it.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: el renglón % no existe', p_pedido_item_id;
    END IF;

    UPDATE public.product_stock_params
       SET min_units = p_min, max_units = p_max,
           manual_min = NULL, manual_max = NULL,
           draft_status = 'none', draft_min = NULL, draft_max = NULL,
           updated_at = now()
     WHERE erp_product_id = it.erp_product_id
       AND erp_sucursal_id = it.erp_sucursal_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'NOT_FOUND: el producto no tiene MIN·MAX en esa sala';
    END IF;

    RETURN json_build_object('ok', true,
                             'erp_product_id', it.erp_product_id,
                             'erp_sucursal_id', it.erp_sucursal_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guardar_minmax_desde_pedido(integer, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_minmax_desde_pedido(integer, integer, integer) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 3 · Los avisos de un pedido, sólo a quien puede ver Pedidos
-- ══════════════════════════════════════════════════════════════════════════
--
-- `notify_branch` le avisaba a toda la sala. Servicios Generales de Salud 4
-- recibía «en preparación», «en camino» y «llegó el conductor» —48 avisos, 0
-- abiertos— sin permiso para entrar a Pedidos. Para los tipos `PEDIDO_*` el
-- destinatario pasa a ser quien tiene `pedidos.can_view`, y el teléfono se
-- avisa por persona y no por sala (el push por sala alcanzaría al mismo que se
-- acaba de filtrar).
CREATE OR REPLACE FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor   uuid := public.auth_employee_id();
  v_modulo  text := CASE WHEN p_type LIKE 'PEDIDO\_%' THEN 'pedidos' END;
  v_ids     uuid[];
  v_count   integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT e.id, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
    FROM public.employees e
    WHERE e.branch_id = p_branch_id
      AND e.status = 'ACTIVO'
      AND (v_actor IS NULL OR e.id <> v_actor)
      AND (v_modulo IS NULL OR EXISTS (
            SELECT 1 FROM public.role_permissions rp
             WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
               AND rp.module_key = v_modulo AND rp.can_view))
    RETURNING recipient_id
  )
  SELECT count(*), array_agg(recipient_id) INTO v_count, v_ids FROM ins;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title', p_title,
        -- La línea corta del teléfono (24-sep); sin datos, el cuerpo de siempre.
        'message', public.texto_de_push(p_type, COALESCE(p_body, ''), p_metadata),
        'url', COALESCE(p_link, '/home')
      ) || CASE WHEN v_modulo IS NULL
                THEN jsonb_build_object('target_type', 'BRANCH',
                                        'target_value', jsonb_build_array(p_branch_id))
                ELSE jsonb_build_object('target_type', 'EMPLOYEE',
                                        'target_value', to_jsonb(v_ids))
           END
    );
  END IF;

  RETURN v_count;
END;
$function$;
