SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bitacora_hoy_sv()
RETURNS date LANGUAGE sql STABLE
SET search_path = public, extensions AS $fn$
    SELECT (now() AT TIME ZONE 'America/El_Salvador')::date;
$fn$;

CREATE OR REPLACE FUNCTION public.bitacora_ahora_sv()
RETURNS timestamp LANGUAGE sql STABLE
SET search_path = public, extensions AS $fn$
    SELECT (now() AT TIME ZONE 'America/El_Salvador');
$fn$;

CREATE OR REPLACE FUNCTION public.bitacora_periodo_cerrado(p_branch_id bigint, p_periodo text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $fn$
    SELECT coalesce((
        SELECT c.accion = 'cerrar'
          FROM public.bitacora_cierres c
         WHERE c.branch_id = p_branch_id AND c.periodo = p_periodo
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT 1
    ), false);
$fn$;

CREATE OR REPLACE FUNCTION public.bitacora_exigir_acceso(p_branch_id bigint, p_accion text DEFAULT 'can_edit')
RETURNS void LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $fn$
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras', p_accion) THEN
        RAISE EXCEPTION 'Tu cargo no tiene el modulo de bitacoras.' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('bitacoras') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Solo podes trabajar las bitacoras de tu sala.' USING ERRCODE = '42501';
    END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bitacora_estado_franja(
    p_fecha date, p_desde time, p_hasta time, p_hay_registro boolean
) RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions AS $fn$
    SELECT CASE
        WHEN p_hay_registro                              THEN 'hecha'
        WHEN p_fecha > public.bitacora_hoy_sv()          THEN 'proxima'
        WHEN p_fecha < public.bitacora_hoy_sv()          THEN 'vencida'
        WHEN (public.bitacora_ahora_sv())::time < p_desde THEN 'proxima'
        WHEN (public.bitacora_ahora_sv())::time > p_hasta THEN 'vencida'
        ELSE 'abierta'
    END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_bitacora_dia(p_branch_id bigint, p_fecha date)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT json_build_object(
        'fecha',    p_fecha,
        'periodo',  to_char(p_fecha, 'YYYY-MM'),
        'cerrado',  public.bitacora_periodo_cerrado(p_branch_id, to_char(p_fecha, 'YYYY-MM')),
        'hoy_sv',   public.bitacora_hoy_sv(),
        'areas',    coalesce(json_agg(a.obj ORDER BY a.orden, a.nombre), '[]'::json)
    ) INTO v_out
    FROM (
        SELECT
            ar.nombre,
            CASE ar.tipo WHEN 'sala_ventas' THEN 1 WHEN 'bodega' THEN 2 ELSE 3 END AS orden,
            json_build_object(
                'id', ar.id, 'tipo', ar.tipo, 'nombre', ar.nombre,
                'temp_min', ar.temp_min, 'temp_max', ar.temp_max,
                'hr_min', ar.hr_min, 'hr_max', ar.hr_max,
                'mide_humedad', ar.mide_humedad,
                'instrumento', ar.instrumento,
                'calibrado_hasta', ar.calibrado_hasta,
                'calibracion_vencida', ar.calibrado_hasta IS NOT NULL
                                       AND ar.calibrado_hasta < public.bitacora_hoy_sv(),
                'aplica_hoy', extract(isodow FROM p_fecha)::smallint = ANY (ar.dias_semana)
                              AND p_fecha >= ar.vigente_desde,
                'franjas', (
                    SELECT coalesce(json_agg(json_build_object(
                        'clave',  f->>'clave',
                        'label',  f->>'label',
                        'desde',  f->>'desde',
                        'hasta',  f->>'hasta',
                        'estado', public.bitacora_estado_franja(
                                      p_fecha, (f->>'desde')::time, (f->>'hasta')::time, l.id IS NOT NULL),
                        'lectura', CASE WHEN l.id IS NULL THEN NULL ELSE json_build_object(
                            'id', l.id, 'temperatura', l.temperatura, 'humedad', l.humedad,
                            'fuera_de_rango', l.fuera_de_rango,
                            'accion_correctiva', l.accion_correctiva,
                            'tarde', l.tarde,
                            'registrado_at', l.registrado_at,
                            'registrado_por', l.registrado_por,
                            'registrado_por_nombre', e.name,
                            'correcciones', (SELECT count(*) FROM public.bitacora_correcciones c WHERE c.lectura_id = l.id)
                        ) END
                    ) ORDER BY ord), '[]'::json)
                    FROM jsonb_array_elements(ar.franjas) WITH ORDINALITY AS t(f, ord)
                    LEFT JOIN public.bitacora_lecturas l
                           ON l.area_id = ar.id AND l.fecha = p_fecha AND l.franja = f->>'clave'
                    LEFT JOIN public.employees e ON e.id = l.registrado_por
                ),
                'limpiezas', (
                    SELECT coalesce(json_agg(json_build_object(
                        'clave',  f->>'clave',
                        'label',  f->>'label',
                        'desde',  f->>'desde',
                        'hasta',  f->>'hasta',
                        'estado', public.bitacora_estado_franja(
                                      p_fecha, (f->>'desde')::time, (f->>'hasta')::time, li.id IS NOT NULL),
                        'registro', CASE WHEN li.id IS NULL THEN NULL ELSE json_build_object(
                            'id', li.id, 'observaciones', li.observaciones, 'tarde', li.tarde,
                            'registrado_at', li.registrado_at,
                            'realizada_por', li.realizada_por,
                            'realizada_por_nombre', e2.name
                        ) END
                    ) ORDER BY ord), '[]'::json)
                    FROM jsonb_array_elements(ar.limpiezas) WITH ORDINALITY AS t2(f, ord)
                    LEFT JOIN public.bitacora_limpiezas li
                           ON li.area_id = ar.id AND li.fecha = p_fecha AND li.turno = f->>'clave'
                    LEFT JOIN public.employees e2 ON e2.id = li.realizada_por
                )
            ) AS obj
        FROM public.bitacora_areas ar
        WHERE ar.branch_id = p_branch_id AND ar.activa
    ) a;

    RETURN coalesce(v_out, json_build_object('fecha', p_fecha, 'areas', '[]'::json));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.registrar_lectura_bitacora(
    p_area_id     bigint,
    p_fecha       date,
    p_franja      text,
    p_temperatura numeric,
    p_humedad     numeric DEFAULT NULL,
    p_accion      text    DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_area   public.bitacora_areas%ROWTYPE;
    v_franja jsonb;
    v_fuera  boolean;
    v_tarde  boolean;
    v_ahora  timestamp := public.bitacora_ahora_sv();
    v_id     bigint;
BEGIN
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = p_area_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa area no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF NOT v_area.activa THEN
        RAISE EXCEPTION 'Esa area esta desactivada.' USING ERRCODE = 'P0001';
    END IF;

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(p_fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder anotar.' USING ERRCODE = 'P0001';
    END IF;

    SELECT f INTO v_franja
      FROM jsonb_array_elements(v_area.franjas) f
     WHERE f->>'clave' = p_franja;
    IF v_franja IS NULL THEN
        RAISE EXCEPTION 'Esa franja no existe en la configuracion del area.' USING ERRCODE = 'P0002';
    END IF;

    IF p_fecha > public.bitacora_hoy_sv()
       OR (p_fecha = public.bitacora_hoy_sv()
           AND v_ahora::time < (v_franja->>'desde')::time - interval '15 minutes') THEN
        RAISE EXCEPTION 'Todavia no toca esa lectura.' USING ERRCODE = 'P0001';
    END IF;

    v_fuera := (v_area.temp_min IS NOT NULL AND p_temperatura < v_area.temp_min)
            OR (v_area.temp_max IS NOT NULL AND p_temperatura > v_area.temp_max);

    IF v_fuera AND coalesce(btrim(p_accion), '') = '' THEN
        RAISE EXCEPTION 'La temperatura esta fuera de rango: hay que anotar que se hizo.' USING ERRCODE = 'P0001';
    END IF;

    v_tarde := p_fecha <> public.bitacora_hoy_sv()
            OR v_ahora::time < (v_franja->>'desde')::time
            OR v_ahora::time > (v_franja->>'hasta')::time;

    INSERT INTO public.bitacora_lecturas (
        area_id, fecha, franja, temperatura, humedad,
        fuera_de_rango, accion_correctiva, registrado_por, registrado_at, tarde
    ) VALUES (
        p_area_id, p_fecha, p_franja, p_temperatura,
        CASE WHEN v_area.mide_humedad THEN p_humedad ELSE NULL END,
        v_fuera, nullif(btrim(p_accion), ''), public.auth_employee_id(), now(), v_tarde
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Esa franja ya tiene su lectura. Para cambiarla hay que corregirla.' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.corregir_lectura_bitacora(
    p_lectura_id  bigint,
    p_temperatura numeric,
    p_humedad     numeric,
    p_accion      text,
    p_motivo      text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_l     public.bitacora_lecturas%ROWTYPE;
    v_area  public.bitacora_areas%ROWTYPE;
    v_fuera boolean;
BEGIN
    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Una correccion sin motivo no se puede guardar.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_l FROM public.bitacora_lecturas WHERE id = p_lectura_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa lectura no existe.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = v_l.area_id;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(v_l.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder corregir.' USING ERRCODE = 'P0001';
    END IF;

    v_fuera := (v_area.temp_min IS NOT NULL AND p_temperatura < v_area.temp_min)
            OR (v_area.temp_max IS NOT NULL AND p_temperatura > v_area.temp_max);
    IF v_fuera AND coalesce(btrim(p_accion), '') = '' THEN
        RAISE EXCEPTION 'La temperatura esta fuera de rango: hay que anotar que se hizo.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.bitacora_correcciones (
        lectura_id, temperatura_antes, humedad_antes, accion_antes,
        temperatura_despues, humedad_despues, accion_despues, motivo, corregido_por
    ) VALUES (
        p_lectura_id, v_l.temperatura, v_l.humedad, v_l.accion_correctiva,
        p_temperatura, p_humedad, nullif(btrim(p_accion), ''), btrim(p_motivo),
        public.auth_employee_id()
    );

    UPDATE public.bitacora_lecturas
       SET temperatura = p_temperatura,
           humedad = CASE WHEN v_area.mide_humedad THEN p_humedad ELSE NULL END,
           fuera_de_rango = v_fuera,
           accion_correctiva = nullif(btrim(p_accion), '')
     WHERE id = p_lectura_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.registrar_limpieza_bitacora(
    p_area_id bigint,
    p_fecha   date,
    p_turno   text,
    p_observaciones text DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_area  public.bitacora_areas%ROWTYPE;
    v_turno jsonb;
    v_ahora timestamp := public.bitacora_ahora_sv();
    v_tarde boolean;
    v_id    bigint;
BEGIN
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = p_area_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa area no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(p_fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder anotar.' USING ERRCODE = 'P0001';
    END IF;

    SELECT f INTO v_turno FROM jsonb_array_elements(v_area.limpiezas) f WHERE f->>'clave' = p_turno;
    IF v_turno IS NULL THEN
        RAISE EXCEPTION 'Ese turno de limpieza no existe en la configuracion del area.' USING ERRCODE = 'P0002';
    END IF;

    IF p_fecha > public.bitacora_hoy_sv()
       OR (p_fecha = public.bitacora_hoy_sv()
           AND v_ahora::time < (v_turno->>'desde')::time - interval '15 minutes') THEN
        RAISE EXCEPTION 'Todavia no toca esa limpieza.' USING ERRCODE = 'P0001';
    END IF;

    v_tarde := p_fecha <> public.bitacora_hoy_sv()
            OR v_ahora::time < (v_turno->>'desde')::time
            OR v_ahora::time > (v_turno->>'hasta')::time;

    INSERT INTO public.bitacora_limpiezas (area_id, fecha, turno, observaciones, realizada_por, registrado_at, tarde)
    VALUES (p_area_id, p_fecha, p_turno, nullif(btrim(p_observaciones), ''), public.auth_employee_id(), now(), v_tarde)
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ese turno ya quedo registrado.' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_bitacora_resumen_mes(p_branch_id bigint, p_periodo text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_ini date;
    v_fin date;
    v_out json;
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
        SELECT ar.id AS area_id, d.dia::date AS dia, f->>'clave' AS clave
          FROM public.bitacora_areas ar
          CROSS JOIN LATERAL generate_series(v_ini, v_fin, interval '1 day') AS d(dia)
          CROSS JOIN LATERAL jsonb_array_elements(ar.limpiezas) AS f
         WHERE ar.branch_id = p_branch_id AND ar.activa
           AND extract(isodow FROM d.dia)::smallint = ANY (ar.dias_semana)
           AND d.dia::date >= ar.vigente_desde
    ),
    limp_hechas AS (
        SELECT le.area_id, le.dia, le.clave, li.id AS limpieza_id
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

CREATE OR REPLACE FUNCTION public.cerrar_mes_bitacora(
    p_branch_id bigint, p_periodo text, p_observaciones text DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_resumen json;
    v_id bigint;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_cerrar_mes', 'can_edit') THEN
        RAISE EXCEPTION 'Solo el regente puede dar por finalizado el mes.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF public.bitacora_periodo_cerrado(p_branch_id, p_periodo) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_periodo >= to_char(public.bitacora_hoy_sv(), 'YYYY-MM') THEN
        RAISE EXCEPTION 'Ese mes todavia no termina.' USING ERRCODE = 'P0001';
    END IF;

    v_resumen := public.get_bitacora_resumen_mes(p_branch_id, p_periodo);

    INSERT INTO public.bitacora_cierres (branch_id, periodo, accion, resumen, motivo, actor_id)
    VALUES (p_branch_id, p_periodo, 'cerrar', v_resumen, nullif(btrim(p_observaciones), ''), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reabrir_mes_bitacora(
    p_branch_id bigint, p_periodo text, p_motivo text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_id bigint;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_cerrar_mes', 'can_edit') THEN
        RAISE EXCEPTION 'Solo el regente puede reabrir un mes.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Reabrir un mes firmado exige decir por que.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.bitacora_periodo_cerrado(p_branch_id, p_periodo) THEN
        RAISE EXCEPTION 'Ese mes no esta cerrado.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.bitacora_cierres (branch_id, periodo, accion, motivo, actor_id)
    VALUES (p_branch_id, p_periodo, 'reabrir', btrim(p_motivo), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.bitacora_hoy_sv()                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bitacora_ahora_sv()                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bitacora_periodo_cerrado(bigint, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bitacora_exigir_acceso(bigint, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bitacora_estado_franja(date, time, time, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_bitacora_dia(bigint, date)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_lectura_bitacora(bigint, date, text, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.corregir_lectura_bitacora(bigint, numeric, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_limpieza_bitacora(bigint, date, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_bitacora_resumen_mes(bigint, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cerrar_mes_bitacora(bigint, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reabrir_mes_bitacora(bigint, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bitacora_hoy_sv()                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bitacora_ahora_sv()                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bitacora_periodo_cerrado(bigint, text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bitacora_exigir_acceso(bigint, text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bitacora_estado_franja(date, time, time, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bitacora_dia(bigint, date)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_lectura_bitacora(bigint, date, text, numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.corregir_lectura_bitacora(bigint, numeric, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_limpieza_bitacora(bigint, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bitacora_resumen_mes(bigint, text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_mes_bitacora(bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reabrir_mes_bitacora(bigint, text, text) TO authenticated, service_role;
