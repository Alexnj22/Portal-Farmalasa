-- «… y las 7:06 a. m.. Salud 5 …»: el punto de «a. m.» ya cierra la frase, y el
-- que venía detrás de la hora de 24 quedó duplicado al pasarla a 12 horas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_aperturas_de_la_manana(p_fecha date DEFAULT NULL::date, p_forzado boolean DEFAULT false, p_sin_respuesta integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha    date    := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave    text    := 'APERTURAS_MANANA:' || v_fecha::text;
  v_estado   jsonb;
  v_hora     text    := to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI');
  v_abiertas integer;
  v_sin_resp text[];
  v_no_abrio text[];
  v_lista    text;
  v_primera  text;
  v_ultima   text;
  v_titulo   text;
  v_cuerpo   text;
  v_dest     uuid[];
  v_n        integer;
BEGIN
  -- La marca es global (`recipient_id IS NULL`) y vive en `avisos_emitidos`,
  -- no en la campana: un `NOT EXISTS … FROM notifications` pregunta «¿todavía
  -- la tiene?», así que quien vacía su campana lo recibiría de nuevo.
  IF EXISTS (SELECT 1 FROM public.avisos_emitidos a
              WHERE a.clave = v_clave AND a.recipient_id IS NULL) THEN
    RETURN 0;
  END IF;

  v_estado   := public.aperturas_de_la_manana(v_fecha);
  v_abiertas := (v_estado->>'abiertas')::int;

  -- Lo que no contestó el origen se separa de lo que no abrió: no distinguirlos
  -- convierte un rato de origen caído en seis salas acusadas de no abrir.
  SELECT coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE     x.muda), '{}'::text[]),
         coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::text[])
    INTO v_sin_resp, v_no_abrio
    FROM (SELECT f.value #>> '{}' AS sala,
                 (i.value::text)::int = ANY (coalesce(p_sin_respuesta, '{}'::integer[])) AS muda
            FROM jsonb_array_elements(v_estado->'faltan')     WITH ORDINALITY f(value, n)
            JOIN jsonb_array_elements(v_estado->'faltan_ids') WITH ORDINALITY i(value, n)
              ON i.n = f.n) x;

  -- Todavía puede abrir: no es el momento. El cron de la hora tope vuelve con
  -- `p_forzado` y entonces sí sale, diciendo cuáles faltaron.
  IF NOT p_forzado AND (coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0) THEN
    RETURN 0;
  END IF;

  -- Ni una sala abierta y sin forzar: es demasiado temprano, no es una noticia.
  IF NOT p_forzado AND v_abiertas = 0 THEN
    RETURN 0;
  END IF;

  -- La lista: sala, hora y quién. Ya viene ordenada por hora desde el estado,
  -- así que la primera del renglón es la que abrió primero y la última la que
  -- cerró la mañana — que es la que se busca cuando se mira esto.
  SELECT string_agg(
           (s.value->>'sala') || ' ' || public.hora_12((s.value->>'hora')::time) || ' ' ||
           coalesce(s.value->>'quien', 'desde la caja'), ' · ' ORDER BY s.n),
         min(s.value->>'hora'), max(s.value->>'hora')
    INTO v_lista, v_primera, v_ultima
    FROM jsonb_array_elements(v_estado->'salas') WITH ORDINALITY s(value, n);

  /* «apertura» y no «abrieron caja»: es la palabra con la que la pantalla de
   * cajas nombra este acto y con la que el usuario lo busca. Ver el encabezado
   * — el título y el cuerpo son las DOS únicas columnas que mira el buscador
   * de /notificaciones, así que la palabra que no está acá no existe. */
  v_titulo := CASE
    WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
      THEN '⚠️ ' || v_no_abrio[1] || ' no ha hecho su apertura de caja'
    WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
      THEN '⚠️ ' || coalesce(array_length(v_no_abrio, 1), 0) || ' salas no han hecho su apertura de caja'
    WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
      THEN '⚠️ No se pudo comprobar la apertura de caja de ' || array_to_string(v_sin_resp, ', ')
    ELSE 'Las ' || v_abiertas || ' salas hicieron su apertura de caja'
  END;

  v_cuerpo :=
       CASE WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
            THEN 'A las ' || public.hora_12(v_hora::time) || ' todavía no abría ' || v_no_abrio[1] || '. '
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
            THEN 'A las ' || public.hora_12(v_hora::time) || ' todavía no abrían ' ||
                 array_to_string(v_no_abrio, ', ') || '. '
            -- Con todas abiertas el cuerpo tiene que decir algo por sí solo:
            -- es lo que se lee donde la tarjeta no se sabe pintar. Y el rango
            -- va sólo con dos o más, porque «entre las 06:53 y las 06:53» es
            -- una frase que se delata sola.
            WHEN v_abiertas >= 2 AND v_primera IS NOT NULL
            -- Sin punto detrás: «7:06 a. m.» ya cierra la frase con el suyo.
            THEN 'La apertura de caja fue entre las ' || public.hora_12(v_primera::time) || ' y las ' || public.hora_12(v_ultima::time) || ' '
            ELSE '' END
    || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
            ELSE '' END
    || CASE WHEN v_abiertas = 0 THEN 'Ninguna sala había hecho su apertura.'
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'Abrieron: ' || v_lista
            ELSE v_lista END;

  -- SÓLO Supervisor/a de Ventas: lo pidió en primera persona, y es una
  -- vigilancia de operación, no el informe de gerencia que es el cierre del día.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles r ON r.name = 'Supervisor/a de Ventas'
   WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
  IF v_dest IS NULL THEN RETURN 0; END IF;

  v_n := public.notify_employees(
    v_dest,
    'APERTURAS_DE_LA_MANANA',
    v_titulo,
    v_cuerpo,
    '/caja?pestana=cortes',
    jsonb_build_object(
      'fecha',         v_fecha,
      'hora_aviso',    v_hora,
      'forzado',       p_forzado,
      'total',         (v_estado->>'total')::int,
      'abiertas',      v_abiertas,
      'salas',         v_estado->'salas',
      'no_abrieron',   to_jsonb(v_no_abrio),
      'sin_respuesta', to_jsonb(v_sin_resp)),
    -- Push SIEMPRE (2026-09-23). Antes salía sólo cuando faltaba una sala, para
    -- que un «todo bien» diario no enseñara a ignorar los push; el usuario lo
    -- pidió al revés: «si no entro no me entero». Es un solo aviso por mañana.
    true,
    NULL
  );

  -- La marca sólo si algo se mandó de verdad. Escribirla igual dejaría el aviso
  -- del día apagado para siempre por una corrida que no llegó a nadie.
  IF coalesce(v_n, 0) > 0 THEN
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN coalesce(v_n, 0);
END;
$function$;
