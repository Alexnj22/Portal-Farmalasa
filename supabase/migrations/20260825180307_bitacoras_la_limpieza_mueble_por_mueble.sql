SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La limpieza, mueble por mueble.
--
-- ── Qué pidió el usuario ───────────────────────────────────────────────────
-- «en configuración se debe poder configurar cuántas vitrinas tiene la
-- sucursal y cuántos estantes. así al desplegar la limpieza se marcan las que
-- se limpiaron. o una marca para marcar todas como limpiadas».
--
-- ── Qué dice la norma, que es lo que decide la forma ───────────────────────
-- NADA en el RTS 11.02.04:24 ni en la Guía de Verificación de la SRS pide
-- identificar el mueble: lo que exigen es un PROCEDIMIENTO escrito «aplicable a
-- las áreas y mobiliario» (RTS 6.1.11, guía 1.11, MAYOR), autorizado por el
-- regente (6.1.12), con sus registros (5.5.5), y que el local se vea limpio
-- (guía 2.11, CRÍTICO).
--
-- O sea que el detalle no lo manda la SRS: lo manda el procedimiento de la
-- empresa. Y de ahí sale la única regla que importa — **el registro tiene que
-- poder mostrar lo que el procedimiento promete**. Si el escrito que firmó el
-- regente nombra cuatro vitrinas, una casilla que sólo dice «Vitrinas ✓» no
-- alcanza cuando el inspector cruza los dos papeles.
--
-- ── Una LISTA, no un número ────────────────────────────────────────────────
-- El usuario piensa en cantidades («cuántas vitrinas»), y así se pide en
-- pantalla: un contador. Pero lo que se guarda es una lista con clave estable,
-- por el mismo motivo que las franjas: `bitacora_limpiezas.puntos` referencia
-- esas claves, y con un número la clave sería la POSICIÓN — borrar la vitrina 2
-- correría la 3 al lugar de la 2 y los registros de ayer pasarían a hablar de
-- otro mueble. Además una lista permite ponerle nombre («Vitrina de
-- refrigerados»), que es lo que hace que el registro se pueda cruzar contra el
-- procedimiento.
--
-- ── Es OPCIONAL ────────────────────────────────────────────────────────────
-- Un área sin puntos sigue siendo una casilla sola, como hasta hoy. La norma no
-- exige el detalle: exigirlo en el portal obligaría a inventar una lista para
-- poder anotar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Dónde vive la lista y dónde vive lo marcado ───────────────────────
ALTER TABLE public.bitacora_areas
    ADD COLUMN IF NOT EXISTS puntos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bitacora_areas.puntos IS
    'Los muebles que se limpian en esta área: [{clave, label}]. La clave es estable y no se recicla — la referencian los registros.';

ALTER TABLE public.bitacora_limpiezas
    ADD COLUMN IF NOT EXISTS puntos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bitacora_limpiezas.puntos IS
    'Qué se limpió de la lista del área: [{clave, hecho}]. Vacío = el área no lleva detalle.';

-- ── 2 · Registrar la limpieza, con lo que se marcó ────────────────────────
-- Se REEMPLAZA la firma en vez de agregar una sobrecarga: dos funciones con el
-- mismo nombre dejan a PostgREST eligiendo, y ya costó caro en este proyecto
-- (`update_proveedor_manual` tenía dos y la revocación de permisos alcanzó a
-- una sola).
DROP FUNCTION IF EXISTS public.registrar_limpieza_bitacora(bigint, date, text, text);

CREATE OR REPLACE FUNCTION public.registrar_limpieza_bitacora(
    p_area_id       bigint,
    p_fecha         date,
    p_turno         text,
    p_observaciones text DEFAULT NULL,
    p_puntos        jsonb DEFAULT '[]'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_area   public.bitacora_areas%ROWTYPE;
    v_turno  jsonb;
    v_ahora  timestamp := public.bitacora_ahora_sv();
    v_tarde  boolean;
    v_puntos jsonb;
    v_id     bigint;
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

    -- ── El registro lo arma la BASE contra la lista del área ──────────────
    -- Se guarda un renglón por CADA punto configurado, con `hecho` verdadero o
    -- falso segun lo que vino marcado. No se copia lo que mandó el navegador:
    -- si el cliente manda tres de cuatro puntos, la diferencia entre «la cuarta
    -- no se limpió» y «la cuarta no se mandó» desaparece — y ésa es justamente
    -- la que el inspector busca. Y un punto que el navegador invente y que no
    -- esté en la configuración no entra.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'clave', p->>'clave',
               'hecho', coalesce((
                   SELECT (m->>'hecho')::boolean
                     FROM jsonb_array_elements(coalesce(p_puntos, '[]'::jsonb)) m
                    WHERE m->>'clave' = p->>'clave'
                    LIMIT 1), false)
           )), '[]'::jsonb)
      INTO v_puntos
      FROM jsonb_array_elements(coalesce(v_area.puntos, '[]'::jsonb)) p;

    INSERT INTO public.bitacora_limpiezas (area_id, fecha, turno, observaciones, realizada_por, registrado_at, tarde, puntos)
    VALUES (p_area_id, p_fecha, p_turno, nullif(btrim(p_observaciones), ''), public.auth_employee_id(), now(), v_tarde, v_puntos)
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ese turno ya quedo registrado.' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_limpieza_bitacora(bigint, date, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_limpieza_bitacora(bigint, date, text, text, jsonb) TO authenticated, service_role;

-- ── 3 · La ronda le pasa los puntos ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_ronda_bitacora(p_items jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_item      jsonb;
    v_clave     text;
    v_guardados int := 0;
    v_fallidos  jsonb := '[]'::jsonb;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'La ronda tiene que ser una lista de registros.' USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_array_length(p_items) > 40 THEN
        RAISE EXCEPTION 'Son demasiados registros para una sola ronda.' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_clave := coalesce(v_item->>'clave', '');
        BEGIN
            IF (v_item->>'tipo') = 'limpieza' THEN
                PERFORM public.registrar_limpieza_bitacora(
                    (v_item->>'area_id')::bigint,
                    (v_item->>'fecha')::date,
                    v_item->>'turno',
                    v_item->>'observaciones',
                    coalesce(v_item->'puntos', '[]'::jsonb)
                );
            ELSIF (v_item->>'tipo') = 'lectura' THEN
                PERFORM public.registrar_lectura_bitacora(
                    (v_item->>'area_id')::bigint,
                    (v_item->>'fecha')::date,
                    v_item->>'franja',
                    (v_item->>'temperatura')::numeric,
                    nullif(v_item->>'humedad', '')::numeric,
                    v_item->>'accion'
                );
            ELSE
                RAISE EXCEPTION 'Tipo de registro desconocido.' USING ERRCODE = 'P0001';
            END IF;
            v_guardados := v_guardados + 1;
        EXCEPTION WHEN OTHERS THEN
            v_fallidos := v_fallidos || jsonb_build_object('clave', v_clave, 'error', SQLERRM);
        END;
    END LOOP;

    RETURN json_build_object('guardados', v_guardados, 'fallidos', v_fallidos);
END;
$function$;

-- ── 4 · El día trae la lista del área y lo marcado de cada registro ───────
CREATE OR REPLACE FUNCTION public.get_bitacora_dia(p_branch_id bigint, p_fecha date)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
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
                -- Los muebles que se limpian en esta área. Viajan con el día
                -- para que la casilla pueda desplegarse sin una segunda vuelta.
                'puntos', ar.puntos,
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
                            'realizada_por_nombre', e2.name,
                            'puntos', li.puntos,
                            -- Contados en la base y no en la pantalla: es el
                            -- número que también va al mes impreso, y dos
                            -- cuentas del mismo dato terminan discrepando.
                            'puntos_hechos', (
                                SELECT count(*) FROM jsonb_array_elements(li.puntos) q
                                 WHERE (q->>'hecho')::boolean),
                            'puntos_total', jsonb_array_length(li.puntos)
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
$function$;
