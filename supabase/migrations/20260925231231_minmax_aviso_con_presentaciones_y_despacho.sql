-- La tarjeta de MIN·MAX por aprobar muestra la presentación base, el factor de
-- cada presentación y en qué se despacha (usuario, 25-sep: «imagina que me pida
-- 0 / 1 y la caja es x10 factor 10, 1 unidad no se mandará»). El MIN·MAX va en
-- unidades y el pedido despacha en la unidad de `unidad_de_despacho` —el mismo
-- canónico que usa Pedidos—, así que quien aprueba tiene que ver las dos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.notificar_solicitud_minmax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest    uuid[];
    v_suc     text;
    v_cuerpo  text;
    v_branch  bigint;
    v_meses   jsonb;
    v_ctx     json;
    v_pres    json;
    v_desp    json;
BEGIN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

    v_dest := ARRAY(SELECT x FROM unnest(public.get_minmax_approver_ids()) AS x WHERE x IS DISTINCT FROM NEW.requested_by_id);
    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('MINMAX_SIN_APROBADOR', NEW.id::text, 'Sistema', 'SYSTEM', 'WARNING',
                jsonb_build_object('producto', NEW.product_name,
                                   'motivo', 'get_minmax_approver_ids() no devolvió a nadie'));
        RETURN NEW;
    END IF;

    SELECT nombre INTO v_suc
      FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = NEW.erp_sucursal_id;

    -- Las ventas del producto en la sala, para que quien decide no tenga que ir
    -- a buscarlas (usuario, 24-sep: «necesito ver las ventas de los últimos 6
    -- meses, y del último mes»). En UNIDADES —`cantidad × factor_unidades`, igual
    -- que `get_minmax_contexto_producto`— y no sumando presentaciones. Seis
    -- meses CERRADOS, mes por mes; el mes en curso aparte. Si algo falla, el
    -- aviso sale igual sin las ventas: la solicitud no puede caerse por esto.
    BEGIN
        SELECT branch_id INTO v_branch FROM public.erp_sucursal_map
         WHERE erp_sucursal_id = NEW.erp_sucursal_id AND NOT es_bodega;
        -- La misma respuesta que usa el aviso de traslados.
        v_meses := public.ventas_por_mes_de_producto(NEW.erp_product_id, v_branch);
        v_ctx := public.get_minmax_contexto_producto(NEW.erp_product_id, NEW.erp_sucursal_id);
    EXCEPTION WHEN OTHERS THEN
        v_meses := NULL;
        v_ctx   := NULL;
    END;

    -- Las presentaciones con su factor, de la más chica a la más grande (la
    -- primera es la base), y la unidad en que el pedido despacha (25-sep).
    BEGIN
        SELECT json_agg(json_build_object('tipo', p.tipo, 'factor', p.factor) ORDER BY p.factor, p.tipo)
          INTO v_pres
          FROM (SELECT DISTINCT btrim(pres.tipo) AS tipo, pp.factor
                  FROM public.product_precios pp
                  JOIN public.presentaciones pres ON pres.id = pp.id_presentacion
                 WHERE pp.product_id = NEW.erp_product_id AND pp.activo AND pp.factor > 0) p;
        SELECT json_build_object('tipo', u.tipo, 'etiqueta', u.etiqueta, 'factor', u.factor,
                                 'multiplo', u.multiplo, 'unidades', u.unidades)
          INTO v_desp
          FROM public.unidad_de_despacho(ARRAY[NEW.erp_product_id]) u;
    EXCEPTION WHEN OTHERS THEN
        v_pres := NULL;
        v_desp := NULL;
    END;

    v_cuerpo := coalesce(NEW.requested_by_name, 'Un empleado')
             || ' propone MIN ' || NEW.requested_min || ' · MAX ' || NEW.requested_max
             || ' para ' || coalesce(NEW.product_name, 'un producto')
             || coalesce(' (' || v_suc || ')', '')
             || '. Hoy está en MIN ' || coalesce(NEW.current_min::text, '—')
             || ' · MAX ' || coalesce(NEW.current_max::text, '—')
             || coalesce(' — ' || left(nullif(btrim(NEW.reason), ''), 140), '');

    PERFORM public.notify_employees(
        -- Título corto con la sala; lo demás lo dibuja la tarjeta (23-sep).
        v_dest, 'MINMAX_PENDING', 'Ajuste de MIN·MAX' || coalesce(' · ' || v_suc, ''), v_cuerpo,
        '/requests?solicitud=minmax:' || NEW.id,
        jsonb_build_object('request_id', NEW.id, 'request_type', 'MINMAX',
                           'producto', NEW.product_name,
                           -- Lo que dibuja la tarjeta de la campana.
                           'sala',      v_suc,
                           'quien',     NEW.requested_by_name,
                           'quien_id',  NEW.requested_by_id,
                           'quien_foto', public.foto_de_empleado(NEW.requested_by_id),
                           'ventas_meses',     v_meses,
                           'ventas_mes_curso', (v_ctx->>'unidades_mes')::numeric,
                           'existencia',       (v_ctx->>'existencia')::numeric,
                           'presentaciones',   v_pres,
                           'despacho',         v_desp,
                           'min_hoy',   NEW.current_min,
                           'max_hoy',   NEW.current_max,
                           'min_nuevo', NEW.requested_min,
                           'max_nuevo', NEW.requested_max,
                           'motivo',    left(nullif(btrim(NEW.reason), ''), 140)),
        true, NULL
    );

    RETURN NEW;
END;
$function$;
