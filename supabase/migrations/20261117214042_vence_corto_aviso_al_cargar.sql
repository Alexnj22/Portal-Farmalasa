SET lock_timeout = '5s';

-- Producto que entra con vencimiento corto (usuario, 2026-11-17): al cargar
-- una compra o recibir un pedido, si un producto vence en 6 meses o menos, la
-- pantalla lo alerta y se avisa a quien se queda con él:
--   · compra  → la gente de Bodega (la compra entra ahí).
--   · pedido  → la sucursal que lo recibe.
--
-- El criterio se vuelve a calcular ACÁ, no se le cree al navegador: un
-- producto entra al aviso sólo si su mes de vencimiento es a lo sumo el mes de
-- hoy + 6 (hora de El Salvador). Es el mismo corte que `venceCorto` de
-- `src/utils/venceCorto.js`; cambiar uno exige cambiar el otro.
--
-- Una misma carga avisa UNA vez (`referencia`): reintentar no duplica.
-- `notify_employees` ya deja fuera a quien la hizo, que vio la alerta en pantalla.
CREATE OR REPLACE FUNCTION public.notificar_vence_corto(
    p_origen      text,
    p_referencia  text,
    p_detalle     text,
    p_sucursal_id integer,
    p_productos   jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_ref    text := p_origen || ':' || left(coalesce(p_referencia, ''), 120);
    v_tope   date := (date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')) + interval '6 months')::date;
    v_branch integer;
    v_gente  uuid[];
    v_prods  jsonb;
    v_n      integer;
    v_lista  text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF jsonb_typeof(p_productos) <> 'array' THEN RETURN 0; END IF;
    IF coalesce(btrim(p_referencia), '') = '' THEN RAISE EXCEPTION 'Falta la referencia de la carga.'; END IF;

    IF p_origen = 'compra' THEN
        IF NOT (SELECT auth_has_module_permission('cargar_compra', 'can_edit')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
        SELECT branch_id INTO v_branch FROM erp_sucursal_map WHERE es_bodega ORDER BY branch_id LIMIT 1;
        v_link := '/cargar-compra';
    ELSIF p_origen = 'pedido' THEN
        IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF auth_module_scope('pedidos') <> 'ALL'
           AND auth_employee_erp_sucursal_id() IS DISTINCT FROM p_sucursal_id THEN
            RAISE EXCEPTION 'OTRA_SALA: el aviso lo manda la sucursal que recibe el pedido';
        END IF;
        SELECT branch_id INTO v_branch FROM erp_sucursal_map WHERE erp_sucursal_id = p_sucursal_id AND NOT es_bodega;
        v_link := '/pedidos';
    ELSE
        RAISE EXCEPTION 'Origen desconocido: %', p_origen;
    END IF;
    IF v_branch IS NULL THEN RETURN 0; END IF;

    SELECT jsonb_agg(jsonb_build_object('nombre', nombre, 'vence', vence, 'cantidad', cantidad) ORDER BY vence, nombre),
           count(*)
      INTO v_prods, v_n
      FROM (SELECT DISTINCT left(btrim(x->>'nombre'), 120) AS nombre,
                   left(x->>'vence', 7) AS vence,
                   CASE WHEN x->>'cantidad' ~ '^\d+(\.\d+)?$' THEN (x->>'cantidad')::numeric END AS cantidad
              FROM jsonb_array_elements(p_productos) x
             WHERE coalesce(btrim(x->>'nombre'), '') <> ''
               AND x->>'vence' ~ '^\d{4}-(0[1-9]|1[0-2])'
               AND to_date(left(x->>'vence', 7) || '-01', 'YYYY-MM-DD') <= v_tope
             LIMIT 50) t;
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    SELECT array_agg(e.id) INTO v_gente
      FROM employees e
     WHERE e.status = 'ACTIVO' AND e.branch_id = v_branch
       AND (e.tipo_ficha IS NULL OR e.tipo_ficha = 'empleado');
    IF v_gente IS NULL THEN RETURN 0; END IF;

    IF EXISTS (SELECT 1 FROM notifications n
                WHERE n.recipient_id = ANY (v_gente)
                  AND n.type = 'VENCE_CORTO'
                  AND n.metadata->>'referencia' = v_ref) THEN
        RETURN 0;
    END IF;

    SELECT string_agg(p->>'nombre' || ' (' || substr(p->>'vence', 6, 2) || '/' || left(p->>'vence', 4) || ')', ', ')
      INTO v_lista
      FROM (SELECT p FROM jsonb_array_elements(v_prods) p LIMIT 5) s;

    v_titulo := CASE WHEN p_origen = 'compra' THEN 'Compra con vencimiento corto'
                     ELSE 'Te llegó producto que vence pronto' END;
    v_cuerpo := CASE WHEN p_origen = 'compra'
                     THEN 'En la compra de ' || coalesce(nullif(btrim(p_detalle), ''), 'un proveedor') || ', '
                     ELSE coalesce('En el pedido ' || nullif(btrim(p_detalle), ''), 'En el pedido') || ', ' END
             || CASE WHEN v_n = 1 THEN '1 producto vence' ELSE v_n || ' productos vencen' END
             || ' en 6 meses o menos: ' || v_lista
             || CASE WHEN v_n > 5 THEN ' y ' || (v_n - 5) || ' más.' ELSE '.' END;

    RETURN notify_employees(
        v_gente, 'VENCE_CORTO', v_titulo, v_cuerpo, v_link,
        jsonb_build_object('referencia', v_ref, 'origen', p_origen, 'productos', v_prods),
        true, v_branch);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notificar_vence_corto(text, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificar_vence_corto(text, text, text, integer, jsonb) TO authenticated, service_role;
