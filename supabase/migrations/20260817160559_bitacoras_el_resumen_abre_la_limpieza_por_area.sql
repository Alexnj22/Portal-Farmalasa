SET lock_timeout = '5s';

-- `por_area` sale de las LECTURAS, asi que un area que solo se limpia —vitrinas,
-- servicio sanitario— no aparecia en ningun lado del resumen: su trabajo se
-- sumaba al total de limpiezas y ahi se perdia. Un solo porcentaje para «la
-- sala, las vitrinas y el bano» no contesta cual de los tres se esta dejando,
-- que es justo lo que el regente tiene que saber antes de firmar.
--
-- Se agrega `limpieza_por_area` con la misma forma que `por_area`. No reemplaza
-- al agregado: el agregado sigue siendo el numero que se firma.
CREATE OR REPLACE FUNCTION public.get_bitacora_resumen_mes(p_branch_id bigint, p_periodo text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_ini date; v_fin date; v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Periodo invalido: se espera YYYY-MM.' USING ERRCODE = 'P0001';
    END IF;

    v_ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
    v_fin := least((v_ini + interval '1 month - 1 day')::date, public.bitacora_hoy_sv());

    IF v_fin < v_ini THEN
        RETURN json_build_object('periodo', p_periodo, 'branch_id', p_branch_id,
                                 'desde', v_ini, 'hasta', NULL, 'sin_dias', true);
    END IF;

    WITH esperadas AS (
        SELECT ar.id AS area_id, ar.nombre, ar.tipo, d.dia::date AS dia, f->>'clave' AS clave
          FROM public.bitacora_areas ar
          CROSS JOIN LATERAL generate_series(v_ini, v_fin, interval '1 day') AS d(dia)
          CROSS JOIN LATERAL jsonb_array_elements(ar.franjas) AS f
         WHERE ar.branch_id = p_branch_id AND ar.activa
           AND extract(isodow FROM d.dia)::smallint = ANY (ar.dias_semana)
           AND d.dia::date >= ar.vigente_desde
    ),
    hechas AS (
        SELECT e.area_id, e.nombre, e.tipo, e.dia, e.clave, l.id AS lectura_id,
               l.fuera_de_rango, l.accion_correctiva, l.tarde
          FROM esperadas e
          LEFT JOIN public.bitacora_lecturas l
                 ON l.area_id = e.area_id AND l.fecha = e.dia AND l.franja = e.clave
    ),
    limp_esperadas AS (
        SELECT ar.id AS area_id, ar.nombre, ar.tipo, d.dia::date AS dia, f->>'clave' AS clave
          FROM public.bitacora_areas ar
          CROSS JOIN LATERAL generate_series(v_ini, v_fin, interval '1 day') AS d(dia)
          CROSS JOIN LATERAL jsonb_array_elements(ar.limpiezas) AS f
         WHERE ar.branch_id = p_branch_id AND ar.activa
           AND extract(isodow FROM d.dia)::smallint = ANY (ar.dias_semana)
           AND d.dia::date >= ar.vigente_desde
    ),
    limp_hechas AS (
        SELECT le.area_id, le.nombre, le.tipo, le.dia, le.clave, li.id AS limpieza_id, li.tarde
          FROM limp_esperadas le
          LEFT JOIN public.bitacora_limpiezas li
                 ON li.area_id = le.area_id AND li.fecha = le.dia AND li.turno = le.clave
    ),
    fuera_de_plan AS (
        SELECT l.id
          FROM public.bitacora_lecturas l
          JOIN public.bitacora_areas a ON a.id = l.area_id
         WHERE a.branch_id = p_branch_id
           AND l.fecha BETWEEN v_ini AND v_fin
           AND NOT EXISTS (SELECT 1 FROM esperadas e
                            WHERE e.area_id = l.area_id AND e.dia = l.fecha AND e.clave = l.franja)
    )
    SELECT json_build_object(
        'periodo', p_periodo,
        'branch_id', p_branch_id,
        'desde', v_ini, 'hasta', v_fin,
        'cerrado', public.bitacora_periodo_cerrado(p_branch_id, p_periodo),
        'lecturas', json_build_object(
            'esperadas', (SELECT count(*) FROM hechas),
            'hechas',    (SELECT count(*) FROM hechas WHERE lectura_id IS NOT NULL),
            'faltantes', (SELECT count(*) FROM hechas WHERE lectura_id IS NULL),
            'tarde',     (SELECT count(*) FROM hechas WHERE tarde),
            'fuera_de_rango', (SELECT count(*) FROM hechas WHERE fuera_de_rango),
            'sin_accion',(SELECT count(*) FROM hechas WHERE fuera_de_rango AND coalesce(btrim(accion_correctiva),'') = ''),
            'fuera_de_plan', (SELECT count(*) FROM fuera_de_plan)
        ),
        'limpiezas', json_build_object(
            'esperadas', (SELECT count(*) FROM limp_hechas),
            'hechas',    (SELECT count(*) FROM limp_hechas WHERE limpieza_id IS NOT NULL),
            'faltantes', (SELECT count(*) FROM limp_hechas WHERE limpieza_id IS NULL)
        ),
        'correcciones', (
            SELECT count(*) FROM public.bitacora_correcciones c
            JOIN public.bitacora_lecturas l ON l.id = c.lectura_id
            JOIN public.bitacora_areas a ON a.id = l.area_id
            WHERE a.branch_id = p_branch_id AND to_char(l.fecha, 'YYYY-MM') = p_periodo
        ),
        'calibracion_vencida', (
            SELECT coalesce(json_agg(json_build_object(
                'area', a.nombre, 'instrumento', a.instrumento, 'calibrado_hasta', a.calibrado_hasta)), '[]'::json)
            FROM public.bitacora_areas a
            WHERE a.branch_id = p_branch_id AND a.activa
              AND a.calibrado_hasta IS NOT NULL AND a.calibrado_hasta < v_fin
        ),
        'por_area', (
            SELECT coalesce(json_agg(x ORDER BY x->>'nombre'), '[]'::json) FROM (
                SELECT json_build_object(
                    'area_id', area_id, 'nombre', nombre, 'tipo', tipo,
                    'esperadas', count(*),
                    'hechas', count(lectura_id),
                    'faltantes', count(*) - count(lectura_id),
                    'fuera_de_rango', count(*) FILTER (WHERE fuera_de_rango),
                    'tarde', count(*) FILTER (WHERE tarde)
                ) AS x
                FROM hechas GROUP BY area_id, nombre, tipo
            ) s
        ),
        'limpieza_por_area', (
            SELECT coalesce(json_agg(x ORDER BY x->>'nombre'), '[]'::json) FROM (
                SELECT json_build_object(
                    'area_id', area_id, 'nombre', nombre, 'tipo', tipo,
                    'esperadas', count(*),
                    'hechas', count(limpieza_id),
                    'faltantes', count(*) - count(limpieza_id),
                    'tarde', count(*) FILTER (WHERE tarde)
                ) AS x
                FROM limp_hechas GROUP BY area_id, nombre, tipo
            ) s
        ),
        'dias_incompletos', (
            SELECT coalesce(json_agg(json_build_object('dia', dia, 'faltan', faltan) ORDER BY dia), '[]'::json)
            FROM (
                SELECT dia, count(*) FILTER (WHERE lectura_id IS NULL) AS faltan
                FROM hechas GROUP BY dia HAVING count(*) FILTER (WHERE lectura_id IS NULL) > 0
            ) d
        )
    ) INTO v_out;

    RETURN v_out;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_bitacora_resumen_mes(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bitacora_resumen_mes(bigint, text) TO authenticated, service_role;
