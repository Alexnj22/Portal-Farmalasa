-- Encuestas a clientes: ZONAS de campo con su meta (pedido del usuario
-- 2026-11-19). La investigación de mercado se aplica en Chalatenango Norte,
-- Centro y Sur, 100 en cada uno. Quien encuesta ELIGE la zona de una lista —
-- el usuario descartó deducirla del GPS («no confío que puedas saber si están
-- en Chalatenango sur o norte»)—; las coordenadas siguen guardándose y sirven
-- para revisar después.
--
-- Las zonas viven en la encuesta (`zonas_campo`, [{id, nombre, meta}]), como
-- el resto del diseño: el candado de la encuesta ya las congela al aprobarla.
-- La respuesta guarda el `id` de la zona.
--
-- Cierre: con zonas que tienen meta, la encuesta termina cuando TODAS llegan a
-- la suya (en meta general reemplazan al total: una zona que se pasa no cierra
-- la de otra). Una zona que ya llegó sigue aceptando respuestas.
--
-- Las funciones se reescriben desde su definición VIVA (pg_get_functiondef +
-- replace, y falla si el reemplazo no encontró el texto).
-- jsonb-agg: registrar conserva el agregado de ids de opciones de la definición viva (un puñado).
SET lock_timeout = '5s';

-- ── La forma ───────────────────────────────────────────────────────────────
ALTER TABLE public.encuestas_cliente
    ADD COLUMN zonas_campo jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.encuestas_cliente ADD CONSTRAINT encuestas_cliente_zonas_campo_forma
    CHECK (jsonb_typeof(zonas_campo) = 'array' AND jsonb_array_length(zonas_campo) <= 30);
COMMENT ON COLUMN public.encuestas_cliente.zonas_campo IS
    'Campo: las zonas entre las que elige quien encuesta, [{id, nombre, meta}]. Vacío = sin zonas.';

ALTER TABLE public.encuesta_cliente_respuestas ADD COLUMN zona text;
ALTER TABLE public.encuesta_cliente_respuestas ADD CONSTRAINT encuesta_cliente_respuestas_zona_de_campo
    CHECK (zona IS NULL OR (canal = 'campo' AND length(zona) BETWEEN 1 AND 40));
COMMENT ON COLUMN public.encuesta_cliente_respuestas.zona IS
    'Campo: el id de la zona (de encuestas_cliente.zonas_campo) que eligió quien encuestó.';

-- ── Reescrituras desde la definición viva ──────────────────────────────────
CREATE FUNCTION pg_temp.reemplazar(p_def text, p_viejo text, p_nuevo text, p_que text)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
    IF position(p_viejo IN p_def) = 0 THEN
        RAISE EXCEPTION 'zonas de campo: no encontré «%» en la definición viva', p_que;
    END IF;
    RETURN replace(p_def, p_viejo, p_nuevo);
END $f$;

DO $do$
DECLARE d text;
BEGIN
    -- Registrar: exige la zona cuando la encuesta las tiene, y la guarda.
    d := pg_get_functiondef('public.encuesta_cliente_registrar(public.encuestas_cliente,integer,text,jsonb,jsonb,text,integer,uuid,uuid,jsonb)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$    v_prec     integer;$a$, $a$    v_prec     integer;
    v_zona     text;$a$, 'registrar: declare');
    d := pg_temp.reemplazar(d, $a$            RAISE EXCEPTION 'Escribe el lugar donde estás haciendo la encuesta';
        END IF;$a$, $a$            RAISE EXCEPTION 'Escribe el lugar donde estás haciendo la encuesta';
        END IF;
        -- Con zonas, cada respuesta dice en cuál se hizo: la elige quien encuesta.
        IF jsonb_array_length(coalesce(p_enc.zonas_campo, '[]')) > 0 THEN
            v_zona := nullif(btrim(coalesce(p_ubicacion ->> 'zona', '')), '');
            IF v_zona IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_enc.zonas_campo) z
                                              WHERE z ->> 'id' = v_zona) THEN
                RAISE EXCEPTION 'Elige la zona donde estás haciendo la encuesta';
            END IF;
        END IF;$a$, 'registrar: zona');
    d := pg_temp.reemplazar(d, $a$        lugar, lat, lng, precision_m)$a$, $a$        lugar, lat, lng, precision_m, zona)$a$, 'registrar: columnas');
    d := pg_temp.reemplazar(d, $a$        v_lugar, v_lat, v_lng, v_prec)$a$, $a$        v_lugar, v_lat, v_lng, v_prec, v_zona)$a$, 'registrar: valores');
    EXECUTE d;

    -- Cerrar al llegar: con zonas con meta, todas tienen que llegar.
    d := pg_get_functiondef('public.encuesta_cliente_cerrar_si_llego(uuid)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$    v_llego boolean;$a$, $a$    v_llego boolean;
    v_zonas boolean;$a$, 'cerrar: declare');
    d := pg_temp.reemplazar(d, $a$    IF NOT v_llego THEN RETURN false; END IF;$a$, $a$    -- Zonas de campo con meta: termina cuando TODAS llegan a la suya. En meta
    -- general reemplazan al total (una zona que se pasa no cierra la de otra).
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_enc.zonas_campo) z WHERE jsonb_typeof(z -> 'meta') = 'number') THEN
        v_zonas := NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_enc.zonas_campo) z
             WHERE jsonb_typeof(z -> 'meta') = 'number'
               AND (SELECT count(*) FROM public.encuesta_cliente_respuestas r
                     WHERE r.encuesta_id = p_id AND r.zona = z ->> 'id') < (z ->> 'meta')::numeric);
        v_llego := CASE WHEN v_enc.alcance = 'general' THEN v_zonas ELSE v_llego AND v_zonas END;
    END IF;
    IF NOT v_llego THEN RETURN false; END IF;$a$, 'cerrar: zonas');
    EXECUTE d;

    -- Avance: cuánto lleva cada zona.
    d := pg_get_functiondef('public.encuesta_cliente_avance(uuid)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$        'por_canal', (SELECT$a$, $a$        'por_zona', (SELECT coalesce(json_agg(json_build_object(
                         'id', z ->> 'id', 'nombre', z ->> 'nombre',
                         'meta', CASE WHEN jsonb_typeof(z -> 'meta') = 'number' THEN (z ->> 'meta')::numeric::integer END,
                         'respuestas', (SELECT count(*) FROM public.encuesta_cliente_respuestas r
                                         WHERE r.encuesta_id = p_id AND r.zona = z ->> 'id')) ORDER BY t.o), '[]'::json)
                       FROM public.encuestas_cliente e, jsonb_array_elements(e.zonas_campo) WITH ORDINALITY AS t(z, o)
                      WHERE e.id = p_id),
        'por_canal', (SELECT$a$, 'avance: por_zona');
    EXECUTE d;

    -- Para aplicar: las zonas entre las que se elige, con su avance.
    d := pg_get_functiondef('public.encuestas_para_aplicar()'::regprocedure);
    d := pg_temp.reemplazar(d, $a$'incentivo_descripcion', e.incentivo_descripcion, 'fecha_fin', e.fecha_fin,$a$, $a$'incentivo_descripcion', e.incentivo_descripcion, 'fecha_fin', e.fecha_fin,
                   'zonas_campo', (SELECT coalesce(json_agg(json_build_object(
                                       'id', z ->> 'id', 'nombre', z ->> 'nombre',
                                       'meta', CASE WHEN jsonb_typeof(z -> 'meta') = 'number' THEN (z ->> 'meta')::numeric::integer END,
                                       'respuestas', (SELECT count(*) FROM public.encuesta_cliente_respuestas r
                                                       WHERE r.encuesta_id = e.id AND r.zona = z ->> 'id')) ORDER BY t.o), '[]'::json)
                                     FROM jsonb_array_elements(e.zonas_campo) WITH ORDINALITY AS t(z, o)),$a$, 'para aplicar: zonas');
    EXECUTE d;

    -- Ubicaciones: cada punto dice su zona.
    d := pg_get_functiondef('public.encuesta_cliente_ubicaciones(uuid)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$'nps', r.nps, 'fecha', r.created_at)$a$, $a$'nps', r.nps, 'fecha', r.created_at, 'zona', r.zona)$a$, 'ubicaciones: zona');
    EXECUTE d;

    -- Exportar: el nombre de la zona.
    d := pg_get_functiondef('public.encuesta_cliente_respuestas_para_exportar(uuid)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$'duracion_seg', r.duracion_seg)$a$, $a$'duracion_seg', r.duracion_seg,
                   'zona', (SELECT z ->> 'nombre' FROM public.encuestas_cliente x, jsonb_array_elements(x.zonas_campo) z
                             WHERE x.id = p_id AND z ->> 'id' = r.zona LIMIT 1))$a$, 'exportar: zona');
    EXECUTE d;

    -- Duplicar: la versión nueva conserva las zonas.
    d := pg_get_functiondef('public.encuesta_cliente_duplicar(uuid,boolean)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$mensaje_bienvenida, mensaje_cierre, created_by)$a$, $a$mensaje_bienvenida, mensaje_cierre, zonas_campo, created_by)$a$, 'duplicar: columnas');
    d := pg_temp.reemplazar(d, $a$v_src.mensaje_cierre, public.auth_employee_id())$a$, $a$v_src.mensaje_cierre, v_src.zonas_campo, public.auth_employee_id())$a$, 'duplicar: valores');
    EXECUTE d;

    -- Problemas antes de enviar: zonas bien escritas.
    d := pg_get_functiondef('public.encuesta_cliente_problemas_de(public.encuestas_cliente)'::regprocedure);
    d := pg_temp.reemplazar(d, $a$    -- Se cierra por tiempo o por muestra: sin ninguna de las dos no termina nunca.$a$, $a$    -- Zonas de campo (2026-11-19): quien encuesta elige una de la lista.
    IF jsonb_array_length(coalesce(p_enc.zonas_campo, '[]')) > 0 THEN
        IF NOT 'campo' = ANY (p_enc.canales) THEN
            v_out := v_out || 'Las zonas sólo se usan en campo: marca «Campo» o quítalas'::text;
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_enc.zonas_campo) z
                    WHERE jsonb_typeof(z) <> 'object' OR btrim(coalesce(z ->> 'nombre', '')) = ''
                       OR coalesce(z ->> 'id', '') = '' OR length(z ->> 'id') > 40) THEN
            v_out := v_out || 'Cada zona necesita su nombre'::text;
        END IF;
        IF (SELECT count(DISTINCT lower(btrim(z ->> 'nombre'))) <> count(*) OR count(DISTINCT z ->> 'id') <> count(*)
              FROM jsonb_array_elements(p_enc.zonas_campo) z) THEN
            v_out := v_out || 'Hay dos zonas con el mismo nombre'::text;
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_enc.zonas_campo) z
                    WHERE z ? 'meta' AND jsonb_typeof(z -> 'meta') <> 'null'
                      AND (jsonb_typeof(z -> 'meta') <> 'number' OR (z ->> 'meta')::numeric < 1
                           OR (z ->> 'meta')::numeric <> trunc((z ->> 'meta')::numeric))) THEN
            v_out := v_out || 'La meta de una zona tiene que ser un número entero'::text;
        END IF;
    END IF;
    -- Se cierra por tiempo o por muestra: sin ninguna de las dos no termina nunca.$a$, 'problemas: zonas');
    d := pg_temp.reemplazar(d, $a$IF p_enc.fecha_fin IS NULL AND p_enc.meta_total IS NULL AND p_enc.alcance = 'general' THEN$a$, $a$IF p_enc.fecha_fin IS NULL AND p_enc.meta_total IS NULL AND p_enc.alcance = 'general'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_enc.zonas_campo, '[]')) z
                        WHERE jsonb_typeof(z -> 'meta') = 'number') THEN$a$, 'problemas: cierre');
    EXECUTE d;
END $do$;
