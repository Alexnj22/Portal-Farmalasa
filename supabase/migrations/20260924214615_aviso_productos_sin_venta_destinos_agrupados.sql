SET lock_timeout = '5s';

-- Corrige 20260924214033: la lista de destinos agrupaba por una expresión y
-- leía la fila sin agrupar («column e.value must appear in the GROUP BY»).
-- Abortaba antes de mandar nada, así que no llegó a avisar a nadie.

-- `p_muestra_a`: manda el aviso de TODAS las salas a esa persona, con la lista
-- completa (no sólo lo nuevo) y sin anotar nada. Es para ver cómo se ve antes
-- de encenderlo; no toca el registro ni avisa a ningún jefe.
CREATE OR REPLACE FUNCTION public.avisar_productos_sin_venta(p_muestra_a uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_salas  constant jsonb := '[{"erp":5,"branch":2,"sala":"La Popular"},{"erp":1,"branch":4,"sala":"Salud 1"},
                                 {"erp":2,"branch":25,"sala":"Salud 2"},{"erp":3,"branch":27,"sala":"Salud 3"},
                                 {"erp":4,"branch":28,"sala":"Salud 4"},{"erp":7,"branch":29,"sala":"Salud 5"}]';
    v_nombre constant jsonb := '{"1":"Salud 1","2":"Salud 2","3":"Salud 3","4":"Salud 4","5":"La Popular","6":"Bodega","7":"Salud 5"}';
    s        jsonb;
    v_erp    integer;
    v_lista  jsonb;
    v_nuevos jsonb;
    v_dest   uuid[];
    v_meta   jsonb;
    v_n      integer;
    v_costo  numeric;
    v_total  integer := 0;
BEGIN
    -- Sólo el cron (sin sesión) o quien pide una muestra para sí mismo con
    -- permiso de ver Gestión de stock.
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role'
       AND NOT (p_muestra_a IS NOT NULL
                AND p_muestra_a = public.auth_employee_id()
                AND coalesce(public.auth_has_module_permission('gestion_stock', 'can_view'), false)) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(v_salas) LOOP
        v_erp   := (s->>'erp')::int;
        v_lista := public.productos_parados_de_sala(v_erp)::jsonb;

        IF p_muestra_a IS NULL THEN
            -- Lo que dejó de estar parado vuelve a poder avisarse.
            DELETE FROM public.productos_sin_venta_avisados a
             WHERE a.erp_sucursal_id = v_erp
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) e
                                WHERE (e->>'erp_product_id')::int = a.erp_product_id);
            SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_nuevos
              FROM jsonb_array_elements(v_lista) e
             WHERE NOT EXISTS (SELECT 1 FROM public.productos_sin_venta_avisados a
                                WHERE a.erp_sucursal_id = v_erp
                                  AND a.erp_product_id = (e->>'erp_product_id')::int);
        ELSE
            v_nuevos := v_lista;
        END IF;

        CONTINUE WHEN jsonb_array_length(v_nuevos) = 0;

        IF p_muestra_a IS NOT NULL THEN
            v_dest := ARRAY[p_muestra_a];
        ELSE
            SELECT array_agg(e.id) INTO v_dest
              FROM public.employees e JOIN public.roles r ON r.id = e.role_id
             WHERE e.branch_id = (s->>'branch')::int AND e.status = 'ACTIVO' AND r.name = 'Jefe/a de Sala';
        END IF;
        CONTINUE WHEN v_dest IS NULL;

        v_n     := jsonb_array_length(v_nuevos);
        v_costo := (SELECT sum(coalesce((e->>'costo')::numeric, 0)) FROM jsonb_array_elements(v_nuevos) e);

        v_meta := jsonb_build_object('parados', jsonb_build_object(
            'sala', s->>'sala',
            'erp', v_erp,
            'productos', v_n,
            'costo', round(v_costo, 2),
            'en_la_lista', jsonb_array_length(v_lista),
            'muestra', p_muestra_a IS NOT NULL,
            'destinos', (SELECT jsonb_agg(jsonb_build_object(
                                        'erp', g.dest::int, 'sala', v_nombre->>g.dest,
                                        'productos', g.n, 'costo', g.c) ORDER BY g.n DESC, g.dest)
                           FROM (SELECT e->>'destino' AS dest, count(*) AS n,
                                        round(sum(coalesce((e->>'costo')::numeric, 0)), 2) AS c
                                   FROM jsonb_array_elements(v_nuevos) e
                                  GROUP BY 1) g),
            -- Los tres más caros: los que más vale la pena mover primero.
            'ejemplos', (SELECT jsonb_agg(jsonb_build_object(
                                    'producto', e->>'producto',
                                    'existencia', (e->>'existencia')::numeric,
                                    'costo', (e->>'costo')::numeric,
                                    'destino', v_nombre->>(e->>'destino'),
                                    'desde', e->>'desde',
                                    'dias', (e->>'dias')::int,
                                    'ultima_venta', e->>'ultima_venta',
                                    'ultima_entrada', e->>'ultima_entrada',
                                    'entrada_via', e->>'entrada_via',
                                    'reingreso', e->>'reingreso'))
                           FROM (SELECT e FROM jsonb_array_elements(v_nuevos) e
                                  ORDER BY coalesce((e->>'costo')::numeric, 0) DESC LIMIT 3) t)));

        v_total := v_total + public.notify_employees(
            v_dest,
            'PRODUCTOS_SIN_VENTA',
            'Productos sin venta · ' || (s->>'sala'),
            v_n || CASE WHEN v_n = 1 THEN ' producto lleva' ELSE ' productos llevan' END
                || ' 6 meses sin venderse · $' || to_char(v_costo, 'FM999,990.00'),
            '/gestion-stock?sala=' || v_erp,
            v_meta,
            true,
            (s->>'branch')::int);

        IF p_muestra_a IS NULL THEN
            INSERT INTO public.productos_sin_venta_avisados (erp_sucursal_id, erp_product_id)
            SELECT v_erp, (e->>'erp_product_id')::int FROM jsonb_array_elements(v_nuevos) e
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RETURN v_total;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_productos_sin_venta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_productos_sin_venta(uuid) TO authenticated, service_role;
