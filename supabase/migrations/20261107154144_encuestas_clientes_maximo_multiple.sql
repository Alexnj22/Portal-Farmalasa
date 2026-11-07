-- Encuestas a clientes: «Opción múltiple» con un máximo de opciones a marcar
-- (`maximo` en la pregunta; ausente = sin límite). Pedido del usuario el
-- 2026-11-07 para «Seleccione hasta tres opciones».
-- Parte de las definiciones VIVAS de las dos funciones; el único cambio es el
-- máximo. Gemelas en src/utils/encuestasClientes.js (`maximoDe`, `alternarOpcion`).
-- jsonb-agg: agrega los ids de las opciones de UNA pregunta (un puñado); ya estaba así en la definición viva.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.encuesta_cliente_limpiar(p_cuestionario jsonb, p_r jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_out  jsonb := '{}';
    v_pre  jsonb;
    v_id   text;
    v_tipo text;
    v_val  jsonb;
    v_ops  jsonb;
    v_n    integer := 0;
    v_vacio boolean;
    v_ok    boolean;
BEGIN
    IF p_r IS NULL OR jsonb_typeof(p_r) <> 'object' THEN RAISE EXCEPTION 'Respuestas inválidas'; END IF;
    FOR v_pre IN
        SELECT p FROM jsonb_array_elements(coalesce(p_cuestionario -> 'secciones', '[]')) s,
                      jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
    LOOP
        v_n := v_n + 1;
        v_id := v_pre ->> 'id';
        v_tipo := v_pre ->> 'tipo';
        -- La condición se evalúa con lo ya validado (preguntas anteriores).
        CONTINUE WHEN NOT public.encuesta_cliente_cumple(v_pre -> 'condicion', v_out);
        v_val := p_r -> v_id;
        v_vacio := v_val IS NULL OR jsonb_typeof(v_val) = 'null'
                   OR (jsonb_typeof(v_val) = 'string' AND btrim(v_val #>> '{}') = '')
                   OR (jsonb_typeof(v_val) = 'array' AND jsonb_array_length(v_val) = 0);
        IF v_vacio THEN
            IF coalesce((v_pre ->> 'obligatoria')::boolean, false) THEN
                RAISE EXCEPTION 'Falta contestar la pregunta %', v_n;
            END IF;
            CONTINUE;
        END IF;
        v_ops := coalesce((SELECT jsonb_agg(o -> 'id') FROM jsonb_array_elements(coalesce(v_pre -> 'opciones', '[]')) o
                            WHERE btrim(coalesce(o ->> 'texto', '')) <> ''), '[]');
        v_ok := CASE v_tipo
            WHEN 'nps'      THEN jsonb_typeof(v_val) = 'number' AND (v_val #>> '{}')::numeric IN (0,1,2,3,4,5,6,7,8,9,10)
            WHEN 'csat'     THEN jsonb_typeof(v_val) = 'number' AND (v_val #>> '{}')::numeric IN (1,2,3,4,5)
            WHEN 'likert'   THEN jsonb_typeof(v_val) = 'number' AND (v_val #>> '{}')::numeric IN (1,2,3,4,5)
            WHEN 'si_no'    THEN jsonb_typeof(v_val) = 'boolean'
            WHEN 'numero'   THEN jsonb_typeof(v_val) = 'number' AND abs((v_val #>> '{}')::numeric) < 1e9
            WHEN 'texto'    THEN jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') <= 2000
            WHEN 'unica'    THEN jsonb_typeof(v_val) = 'string' AND v_ops @> jsonb_build_array(v_val)
            WHEN 'multiple' THEN jsonb_typeof(v_val) = 'array' AND v_ops @> v_val
                                 AND jsonb_array_length(v_val) = (SELECT count(DISTINCT e) FROM jsonb_array_elements(v_val) e)
                                 -- El máximo (si lo hay): más marcadas de las permitidas no entra.
                                 AND (jsonb_typeof(v_pre -> 'maximo') IS DISTINCT FROM 'number'
                                      OR jsonb_array_length(v_val) <= (v_pre ->> 'maximo')::numeric)
            WHEN 'ranking'  THEN jsonb_typeof(v_val) = 'array' AND v_ops @> v_val AND v_val @> v_ops
                                 AND jsonb_array_length(v_val) = jsonb_array_length(v_ops)
            ELSE false END;
        -- En una variable y no en el IF: plpgsql corta la condición de un IF
        -- en el primer THEN, que sería el del primer WHEN.
        IF NOT coalesce(v_ok, false) THEN
            RAISE EXCEPTION 'La respuesta a la pregunta % no es válida', v_n;
        END IF;
        IF v_tipo = 'texto' THEN v_val := to_jsonb(btrim(v_val #>> '{}')); END IF;
        v_out := v_out || jsonb_build_object(v_id, v_val);
    END LOOP;
    RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.encuesta_cliente_problemas_de(p_enc encuestas_cliente)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_out    text[] := '{}';
    v_sec    jsonb;
    v_pre    jsonb;
    v_ids    text[] := '{}';
    v_vistas jsonb := '{}';   -- id → pregunta, de las ANTERIORES
    v_n      integer := 0;
    v_ns     integer := 0;
    v_tipo   text;
    v_cond   jsonb;
    v_mira   jsonb;
    v_mtipo  text;
    v_op     text;
    v_val    jsonb;
    v_ok     boolean;
    v_ops    integer;
    v_vacias integer;
    v_suc    integer;
    v_sinmeta integer;
    v_tipos  text[] := ARRAY['nps','csat','likert','unica','multiple','si_no','ranking','numero','texto'];
BEGIN
    IF btrim(coalesce(p_enc.nombre, '')) = '' THEN v_out := v_out || 'Falta el nombre de la encuesta'::text; END IF;

    FOR v_sec IN SELECT * FROM jsonb_array_elements(coalesce(p_enc.cuestionario -> 'secciones', '[]')) LOOP
        v_ns := v_ns + 1;
        FOR v_pre IN SELECT * FROM jsonb_array_elements(coalesce(v_sec -> 'preguntas', '[]')) LOOP
            v_n := v_n + 1;
            v_tipo := v_pre ->> 'tipo';
            IF coalesce(v_pre ->> 'id', '') = '' OR (v_pre ->> 'id') = ANY (v_ids) THEN
                v_out := v_out || format('La pregunta %s no tiene un identificador único', v_n);
            END IF;
            IF btrim(coalesce(v_pre ->> 'texto', '')) = '' THEN
                v_out := v_out || format('La pregunta %s no tiene texto', v_n);
            END IF;
            IF v_tipo IS NULL OR NOT v_tipo = ANY (v_tipos) THEN
                v_out := v_out || format('La pregunta %s no tiene un tipo válido', v_n);
            END IF;
            IF v_tipo IN ('unica','multiple','ranking') THEN
                SELECT count(*) FILTER (WHERE btrim(coalesce(o ->> 'texto', '')) <> ''),
                       count(*) FILTER (WHERE btrim(coalesce(o ->> 'texto', '')) = '')
                  INTO v_ops, v_vacias
                  FROM jsonb_array_elements(coalesce(v_pre -> 'opciones', '[]')) o;
                IF v_ops < 2 THEN
                    v_out := v_out || format('La pregunta %s necesita al menos dos opciones', v_n);
                END IF;
                -- Una opción en blanco no se muestra, pero el ordenar la exige
                -- y la rechazaría siempre: se escribe o se quita.
                IF v_vacias > 0 THEN
                    v_out := v_out || format('La pregunta %s tiene una opción sin texto', v_n);
                END IF;
            END IF;
            -- El máximo de una múltiple: un entero de 1 en adelante.
            IF v_pre ? 'maximo' AND jsonb_typeof(v_pre -> 'maximo') <> 'null' AND (
                   v_tipo IS DISTINCT FROM 'multiple'
                OR jsonb_typeof(v_pre -> 'maximo') <> 'number'
                OR (v_pre ->> 'maximo')::numeric < 1
                OR (v_pre ->> 'maximo')::numeric <> trunc((v_pre ->> 'maximo')::numeric)) THEN
                v_out := v_out || format('La pregunta %s tiene un máximo de opciones inválido', v_n);
            END IF;
            IF v_pre ? 'dimension' AND nullif(v_pre ->> 'dimension', '') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_dimensiones WHERE clave = v_pre ->> 'dimension') THEN
                v_out := v_out || format('La pregunta %s mide una dimensión que no existe', v_n);
            END IF;
            -- Una condición sólo puede mirar una pregunta ANTERIOR: mirar una
            -- posterior es una pregunta que nunca se muestra.
            v_cond := v_pre -> 'condicion';
            IF v_cond IS NOT NULL AND jsonb_typeof(v_cond) = 'object' THEN
                IF NOT ((v_cond ->> 'pregunta') = ANY (v_ids)) THEN
                    v_out := v_out || format('La pregunta %s depende de una pregunta que no está antes', v_n);
                ELSE
                    -- Y tiene que poder cumplirse: el operador y el valor del
                    -- tipo de la pregunta que mira (los mismos de
                    -- `encuesta_cliente_cumple` y de `operadoresPara`).
                    v_mira := v_vistas -> (v_cond ->> 'pregunta');
                    v_mtipo := v_mira ->> 'tipo';
                    v_op := v_cond ->> 'operador';
                    v_val := v_cond -> 'valor';
                    v_ok := CASE
                        WHEN v_mtipo IN ('nps','csat','likert','numero') THEN
                            v_op IN ('<=','>=','=') AND jsonb_typeof(v_val) = 'number'
                        WHEN v_mtipo = 'si_no' THEN v_op = '=' AND jsonb_typeof(v_val) = 'boolean'
                        WHEN v_mtipo IN ('unica','multiple') THEN
                            v_op = 'incluye' AND EXISTS (
                                SELECT 1 FROM jsonb_array_elements(coalesce(v_mira -> 'opciones', '[]')) o
                                 WHERE o -> 'id' = v_val AND btrim(coalesce(o ->> 'texto', '')) <> '')
                        ELSE false END;
                    IF NOT coalesce(v_ok, false) THEN
                        v_out := v_out || format('La condición de la pregunta %s no corresponde a la pregunta que mira', v_n);
                    END IF;
                END IF;
            END IF;
            v_ids := v_ids || coalesce(v_pre ->> 'id', '');
            IF coalesce(v_pre ->> 'id', '') <> '' THEN v_vistas := v_vistas || jsonb_build_object(v_pre ->> 'id', v_pre); END IF;
        END LOOP;
    END LOOP;
    IF v_n = 0 THEN v_out := v_out || 'La encuesta no tiene preguntas'::text; END IF;

    IF p_enc.es_plantilla THEN RETURN v_out; END IF;

    IF coalesce(array_length(p_enc.canales, 1), 0) = 0 THEN
        v_out := v_out || 'Elige al menos una forma de aplicarla (QR, entrevista o tablet)'::text;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE meta IS NULL) INTO v_suc, v_sinmeta
      FROM public.encuesta_cliente_sucursales WHERE encuesta_id = p_enc.id;
    IF v_suc = 0 THEN v_out := v_out || 'Elige al menos una sucursal'::text; END IF;
    IF p_enc.alcance = 'sucursales' AND v_sinmeta > 0 THEN
        v_out := v_out || 'Cada sucursal necesita su meta de respuestas'::text;
    END IF;
    -- Se cierra por tiempo o por muestra: sin ninguna de las dos no termina nunca.
    IF p_enc.fecha_fin IS NULL AND p_enc.meta_total IS NULL AND p_enc.alcance = 'general' THEN
        v_out := v_out || 'Define una fecha de cierre o una meta de respuestas'::text;
    END IF;
    IF p_enc.fecha_fin IS NOT NULL AND p_enc.fecha_fin < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
        v_out := v_out || 'La fecha de cierre ya pasó'::text;
    END IF;
    IF p_enc.incentivo_tipo = 'puntos' AND coalesce(p_enc.incentivo_puntos, 0) <= 0 THEN
        v_out := v_out || 'Indica cuántos puntos se dan por responder'::text;
    END IF;
    -- La app de clientes siempre ofrece puntos por contestar: se declaran
    -- acá, no los pone un valor escondido.
    IF 'app' = ANY (p_enc.canales) AND p_enc.incentivo_tipo <> 'puntos' THEN
        v_out := v_out || 'En la app siempre se dan puntos: elige el incentivo «Puntos» e indica cuántos'::text;
    END IF;
    -- La muestra médica la entrega quien entrevista: la tablet corre sin
    -- sesión y no hay quién firme la entrega.
    IF p_enc.incentivo_tipo = 'muestra' AND NOT ('entrevista' = ANY (p_enc.canales)) THEN
        v_out := v_out || 'La muestra médica sólo se entrega en entrevista'::text;
    END IF;
    IF p_enc.incentivo_tipo = 'muestra' AND btrim(coalesce(p_enc.incentivo_descripcion, '')) = '' THEN
        v_out := v_out || 'Describe qué muestra médica se entrega'::text;
    END IF;
    RETURN v_out;
END $function$;
