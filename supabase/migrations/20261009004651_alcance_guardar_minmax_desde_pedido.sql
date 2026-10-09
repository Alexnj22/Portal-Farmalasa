-- 04 · guardar_minmax_desde_pedido compara la sala del renglón (2026-10-08).
--
-- SECURITY DEFINER: salta la policy `psp_update` de product_stock_params, que
-- exige alcance de red en `minmax` o la sala propia. La función sólo pedía
-- `minmax` editar, así que con alcance de UNA sala se podía escribir el MIN·MAX
-- de cualquier otra pasando el id de un renglón de esa sala. Hoy el único
-- cargo con `minmax` BRANCH es Jefe/a de Compras y Logística (1 persona).
--
-- ⚠ gate:alcance: sus argumentos no nombran la sucursal (p_pedido_item_id,
-- p_min, p_max), así que el gate no la lista. El chequeo vive en el cuerpo.
--
-- Partida: definición VIVA de producción (md5 9c69f353…, igual en pruebas).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guardar_minmax_desde_pedido(p_pedido_item_id integer, p_min integer, p_max integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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

    -- La sala del renglón contra el alcance de quien llama (2026-10-08). Es la
    -- misma regla que la policy `psp_update`: MIN·MAX con alcance de red, o la
    -- sala propia. Sin esto, quien tiene `minmax` de una sala (hoy Jefe/a de
    -- Compras y Logística) cambiaba el MIN·MAX de cualquier sucursal pasando
    -- el id de un renglón de otra — la función es DEFINER y salta la policy.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']))
       AND it.erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese renglón es de otra sucursal';
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
