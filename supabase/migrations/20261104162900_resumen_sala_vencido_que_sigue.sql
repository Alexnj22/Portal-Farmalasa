SET lock_timeout = '5s';
-- El vencido que Saly ya dijo y sigue a la venta vuelve al titular cada 3
-- días (usuario, 2026-11-04, «opción 1»). Antes sólo se nombraban los NUEVOS
-- respecto de ayer: desde el segundo día el resumen decía «Sin novedades»
-- con 11 vencidos en el estante de Salud 2.
-- Los días se cuentan por los resúmenes anteriores que ya traían ese mismo
-- producto y lote. La novedad lleva `insiste` para que Saly lo diga con más
-- preocupación. Se parte de la definición VIVA y se agrega sólo el bloque 4b.
DO $$
DECLARE d text; ancla text; bloque text;
BEGIN
    d := pg_get_functiondef('public.resumen_sala_novedades(bigint,jsonb)'::regprocedure);
    IF position('''insiste''' IN d) > 0 THEN RETURN; END IF;
    ancla := $v$    -- 5 · Lo que ENTRA a los 30 días de vencer$v$;
    IF position(ancla IN d) = 0 THEN RAISE EXCEPTION 'resumen_sala_novedades cambió: no encuentro el bloque 5'; END IF;
    bloque := $v$    -- 4b · El vencido ya dicho que sigue a la venta vuelve cada 3 días.
    SELECT jsonb_agg(s.z ORDER BY (s.z->>'dias')::int DESC) INTO v_nuevos
      FROM (SELECT x || jsonb_build_object('dias', 1 + count(r.fecha)) AS z
              FROM jsonb_array_elements(p_ind->'vencimiento'->'vencidos') x
              JOIN public.resumen_sala_diario r
                ON r.branch_id = p_branch_id AND r.fecha BETWEEN v_f - 90 AND v_f - 1
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.indicadores->'vencimiento'->'vencidos') y
                            WHERE y->>'id' = x->>'id' AND y->>'lote' = x->>'lote')
             GROUP BY x) s
     WHERE (s.z->>'dias')::int >= 3 AND (s.z->>'dias')::int % 3 = 0;
    IF v_nuevos IS NOT NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'vencidos_siguen', 'nivel', 'alta', 'insiste', true,
            'texto', format('%s %s que ya se había%s señalado sigue%s vencido%s y a la venta: %s días.',
                            jsonb_array_length(v_nuevos),
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN 'producto' ELSE 'productos' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN '' ELSE 'n' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN '' ELSE 'n' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN '' ELSE 's' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN 'lleva ' ELSE 'el más antiguo lleva ' END
                              || (v_nuevos->0->>'dias')),
            'productos', (SELECT jsonb_agg(x->>'producto') FROM jsonb_array_elements(v_nuevos) x)));
    END IF;

$v$;
    EXECUTE replace(d, ancla, bloque || ancla);
END $$;
