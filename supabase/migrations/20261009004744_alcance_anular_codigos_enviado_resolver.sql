-- 02 · Pedidos: las funciones que no comparaban la sucursal (2026-10-08).
--
-- 34 personas de sala (Dependiente de Farmacia 21, Regente de Enfermería 7,
-- Jefe/a de Sala 6) tienen `pedidos` can_edit con alcance BRANCH. Estas cuatro
-- funciones SECURITY DEFINER sólo pedían `auth_can_edit_any(['pedidos'])`, así
-- que les alcanzaba para tocar lo de cualquier sucursal:
--
--   · anular_pedido            → anular un pedido entero (todas sus salas).
--   · init_pedido_sucursal_codigos → escribir filas de pedido_sucursal_status
--                                 de cualquier sala.
--   · marcar_pedido_enviado    → pasar un pedido a 'enviado'.
--   · resolve_pedido_item      → proponer/confirmar/rechazar la diferencia de
--                                 un renglón de otra sala.
--
-- El modelo es el de `confirmar_envio_pedido` y `update_pedido_sucursal_lifecycle`
-- (decisión 2026-10-02): lo de Bodega exige `auth_can_edit_scope_all`; lo de la
-- sala, que la sucursal sea la propia salvo alcance de red.
--
-- marcar_pedido_enviado NO la llama nadie (medido: `src/`, `apps/`,
-- `supabase/functions/`, crons y funciones de la base). `crear_ruta` hace lo
-- mismo por su cuenta. Se le revoca EXECUTE y, por las dudas, también lleva el
-- chequeo de Bodega.
--
-- resolve_pedido_item: hoy tampoco la llama ninguna pantalla —`handleResolverItem`
-- se exporta del hook y nadie lo usa; las diferencias van por
-- `decidir_diferencia_pedido`—, pero sigue ejecutable, así que se cierra igual.
--
-- ⚠ gate:alcance: ninguna de las cuatro tiene `branch|sala|sucursal` en sus
-- argumentos, así que el gate no las lista y declararlas en el manifiesto lo
-- haría FALLAR. El chequeo vive en el cuerpo (ver el informe).
--
-- Partida: definiciones VIVAS de producción (md5 anular 412b2d24…, init
-- 82212ad4…, marcar_enviado 9f78dd06…, resolve 92f104af…; iguales en pruebas).
-- Verificado antes de aplicar (2026-10-09): quienes generan o anularon pedidos
-- en 60 días (Auxiliar de Bodega, Administrador, Supervisión, Talento Humano, QA)
-- tienen `pedidos` con alcance ALL.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.anular_pedido(p_pedido_id uuid, p_anulado_por uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_status text;
    v_actor  uuid := auth_employee_id();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    -- Anular afecta a TODAS las salas del pedido: es de Bodega (2026-10-08).
    -- Antes bastaba `pedidos` can_edit, que tienen 34 personas de sala con
    -- alcance de su propia sucursal.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: anular un pedido es de Bodega';
    END IF;

    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    IF v_status IN ('completado', 'anulado', 'parcial') THEN
        RAISE EXCEPTION 'El pedido está % y no puede ser anulado.', v_status;
    END IF;

    UPDATE pedido_items
    SET status = 'anulado'
    WHERE pedido_id = p_pedido_id AND status = 'pendiente';

    UPDATE pedidos
    SET status           = 'anulado',
        anulado_por      = v_actor,
        anulado_at       = now(),
        motivo_anulacion = p_motivo
    WHERE id = p_pedido_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.init_pedido_sucursal_codigos(p_pedido_id uuid, p_codigos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    item JSONB;
BEGIN
    IF auth_employee_id() IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    -- Los códigos se ponen al GENERAR el pedido, que es de Bodega (2026-10-08):
    -- con alcance de sala se podían escribir filas de cualquier sucursal.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: generar un pedido es de Bodega';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(p_codigos)
    LOOP
        INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id, codigo)
        VALUES (
            p_pedido_id,
            (item->>'erp_sucursal_id')::INTEGER,
            item->>'codigo'
        )
        ON CONFLICT (pedido_id, erp_sucursal_id) DO UPDATE
            SET codigo = EXCLUDED.codigo
            WHERE pedido_sucursal_status.codigo IS NULL;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_pedido_enviado(p_pedido_id uuid, p_enviado_por uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_status text;
  v_actor  uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: despachar un pedido es de Bodega';
  END IF;

  SELECT status INTO v_status
  FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status <> 'confirmado' THEN
    RAISE EXCEPTION 'Solo un pedido en estado "confirmado" puede marcarse como enviado (estado actual: %).', v_status;
  END IF;

  UPDATE pedidos
  SET status      = 'enviado',
      enviado_por = v_actor,
      enviado_at  = now()
  WHERE id = p_pedido_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_pedido_enviado(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.marcar_pedido_enviado(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid DEFAULT NULL::uuid, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_pedido_id UUID;
    v_suc_id    INTEGER;
    v_cur_res   TEXT;
    v_actor     uuid := auth_employee_id();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pedido_id, erp_sucursal_id, resolucion_status
    INTO   v_pedido_id, v_suc_id, v_cur_res
    FROM   pedido_items WHERE id = p_item_id FOR UPDATE;

    IF v_pedido_id IS NULL THEN
        RAISE EXCEPTION 'Item no encontrado.';
    END IF;

    -- El renglón tiene que ser de la sala de quien llama, salvo alcance de red
    -- (2026-10-08). El id viene del navegador: sin esto, un cargo de sala
    -- proponía, confirmaba o rechazaba diferencias de OTRA sucursal. La
    -- función viva no distingue turnos sala/bodega por acción —cualquiera con
    -- `pedidos` editar hace las tres—, y eso no se cambia acá.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos']))
       AND v_suc_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese renglón es de otra sucursal';
    END IF;

    IF p_action = 'proponer' THEN
        UPDATE pedido_items SET
            resolucion_status  = 'propuesta',
            resolucion_tipo    = p_tipo,
            resolucion_nota    = NULLIF(TRIM(COALESCE(p_nota, '')), ''),
            resuelto_por       = v_actor,
            resuelto_at        = NOW(),
            rechazado_por      = NULL,
            rechazado_at       = NULL,
            nota_rechazo       = NULL,
            confirmado_suc_por = NULL,
            confirmado_suc_at  = NULL
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_propuesta',
             p_tipo, NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSIF p_action = 'confirmar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede confirmar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status  = 'confirmada',
            confirmado_suc_por = v_actor,
            confirmado_suc_at  = NOW()
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_confirmada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

        PERFORM public.cerrar_pedido_si_todo_resuelto(v_pedido_id, v_suc_id, v_actor);

    ELSIF p_action = 'rechazar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede rechazar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status = 'rechazada',
            rechazado_por     = v_actor,
            rechazado_at      = NOW(),
            nota_rechazo      = NULLIF(TRIM(COALESCE(p_nota, '')), '')
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_rechazada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSE
        RAISE EXCEPTION 'Acción desconocida: %', p_action;
    END IF;
END;
$function$;
