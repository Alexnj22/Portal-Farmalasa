-- El detalle de una solicitud de MIN·MAX (Solicitudes) muestra lo mismo que la
-- tarjeta de la campana: ventas de los 6 meses cerrados y del último, la
-- presentación base, en qué se despacha y el factor (usuario, 26-sep: «aquí no
-- modificaste eso, no me sale el factor, ni las mejoras de la notificación»).
-- Una sola función para los dos: la campana la llama al crear el aviso y el
-- detalle al abrirse —así también sirve para solicitudes anteriores—. Escrito
-- dos veces, un día dirían números distintos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.contexto_de_solicitud_minmax(p_erp_product_id integer, p_erp_sucursal_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- DEFINER como `get_minmax_contexto_producto`, su vecina en el mismo detalle:
-- unidades vendidas y presentaciones de un producto, nada de personas. plpgsql
-- porque el plan de las ventas depende de los argumentos.
DECLARE
    v_branch bigint;
    v_meses  jsonb;
    v_pres   json;
    v_desp   json;
BEGIN
    IF p_erp_product_id IS NULL THEN RETURN NULL; END IF;

    SELECT branch_id INTO v_branch FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = p_erp_sucursal_id AND NOT es_bodega;
    v_meses := public.ventas_por_mes_de_producto(p_erp_product_id, v_branch);

    -- De la más chica (la base) a la más grande.
    SELECT json_agg(json_build_object('tipo', p.tipo, 'factor', p.factor) ORDER BY p.factor, p.tipo)
      INTO v_pres
      FROM (SELECT DISTINCT btrim(pres.tipo) AS tipo, pp.factor
              FROM public.product_precios pp
              JOIN public.presentaciones pres ON pres.id = pp.id_presentacion
             WHERE pp.product_id = p_erp_product_id AND pp.activo AND pp.factor > 0) p;

    -- La unidad en que el pedido despacha: el mismo canónico de Pedidos.
    SELECT json_build_object('tipo', u.tipo, 'etiqueta', u.etiqueta, 'factor', u.factor,
                             'multiplo', u.multiplo, 'unidades', u.unidades)
      INTO v_desp
      FROM public.unidad_de_despacho(ARRAY[p_erp_product_id]) u;

    RETURN json_build_object('ventas_meses', v_meses, 'presentaciones', v_pres, 'despacho', v_desp);
END;
$function$;

REVOKE ALL ON FUNCTION public.contexto_de_solicitud_minmax(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contexto_de_solicitud_minmax(integer, integer) TO authenticated, service_role;

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
    v_ctx     json;
    v_extra   json;
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

    -- Ventas de los 6 meses cerrados, presentaciones y despacho: la misma
    -- respuesta que ve el detalle de la solicitud (24 y 26-sep). El mes en curso
    -- y la existencia salen de `get_minmax_contexto_producto`. Si algo falla, el
    -- aviso sale igual sin esto: la solicitud no puede caerse por un dato de
    -- contexto.
    BEGIN
        v_extra := public.contexto_de_solicitud_minmax(NEW.erp_product_id, NEW.erp_sucursal_id);
        v_ctx   := public.get_minmax_contexto_producto(NEW.erp_product_id, NEW.erp_sucursal_id);
    EXCEPTION WHEN OTHERS THEN
        v_extra := NULL;
        v_ctx   := NULL;
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
                           'ventas_meses',     v_extra->'ventas_meses',
                           'ventas_mes_curso', (v_ctx->>'unidades_mes')::numeric,
                           'existencia',       (v_ctx->>'existencia')::numeric,
                           'presentaciones',   v_extra->'presentaciones',
                           'despacho',         v_extra->'despacho',
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
