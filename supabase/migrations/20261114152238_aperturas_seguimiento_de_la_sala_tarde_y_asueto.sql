SET lock_timeout = '5s';

-- Aperturas de la mañana: el seguimiento de la sala que abrió tarde y el
-- asueto (2026-11-14, pedido del usuario).
--
-- Antes: a las 7:20, si una sala no había abierto, salía «⚠️ X no ha hecho su
-- apertura» y ya no salía nada más ese día — si abría a las 8, ese aviso
-- quedaba como la última palabra. Y en asueto acusaba igual.
--
-- Ahora:
--   · el aviso de las 7:20 deja una marca por sala acusada
--     (`APERTURA_FALTO:<fecha>:<branch_id>` en `avisos_emitidos`, global);
--   · un trigger AFTER INSERT sobre `cortes_caja_aperturas` —la fila nace
--     cuando el sync ve la apertura— avisa UNA vez por sala y día
--     (`APERTURA_TARDE:<fecha>:<branch_id>`) que esa sala ya abrió, con la
--     hora real. Trigger y no el cron: no depende de qué corrida la vea, y la
--     marca garantiza que salga una vez aunque la vean dos;
--   · en asueto nacional (`holidays` sin municipio, fecha exacta o recurrente
--     por mes/día) no se acusa: si abrió alguna, el aviso dice que es asueto y
--     lista las que abrieron; si no abrió ninguna, no sale nada. Sin marcas
--     de «faltó», así que tampoco hay seguimiento. Los asuetos LOCALES no se
--     miran: `branches` no tiene municipio con que cruzarlos.
-- Mismo tipo (`APERTURAS_DE_LA_MANANA`) y misma forma de `metadata`, para que
-- la tarjeta de la campana (`aperturasDeLaManana.js`) lo dibuje sin cambios.
-- Partido de la definición VIVA de `avisar_aperturas_de_la_manana`.

CREATE OR REPLACE FUNCTION public.asueto_nacional(p_fecha date)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT h.name
    FROM public.holidays h
   WHERE h.municipality IS NULL
     AND (h.holiday_date = p_fecha
          OR (coalesce(h.is_recurring, false)
              AND extract(month FROM h.holiday_date) = extract(month FROM p_fecha)
              AND extract(day   FROM h.holiday_date) = extract(day   FROM p_fecha)))
   ORDER BY (h.holiday_date = p_fecha) DESC, h.name
   LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.asueto_nacional(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.asueto_nacional(date) TO authenticated, service_role;

-- Quién recibe los avisos de apertura: una sola definición para el de la
-- mañana y el seguimiento, así no pueden ir a gente distinta.
CREATE OR REPLACE FUNCTION public.destinatarios_de_aperturas()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_agg(DISTINCT e.id)
    FROM public.employees e
    JOIN public.roles r ON r.name = 'Supervisor/a de Ventas'
   WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
$function$;

REVOKE EXECUTE ON FUNCTION public.destinatarios_de_aperturas() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.destinatarios_de_aperturas() TO service_role;

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
  v_no_abrio_ids integer[];
  v_asueto   text    := public.asueto_nacional(v_fecha);
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
         coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::text[]),
         coalesce(array_agg(x.bid  ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::integer[])
    INTO v_sin_resp, v_no_abrio, v_no_abrio_ids
    FROM (SELECT f.value #>> '{}' AS sala,
                 (i.value::text)::int AS bid,
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

  -- Asueto (2026-11-14): no se acusa a nadie. Si no abrió ninguna, no hay
  -- noticia; si abrió alguna, el aviso lo dice como asueto.
  IF v_asueto IS NOT NULL AND v_abiertas = 0 THEN
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

  IF v_asueto IS NOT NULL AND coalesce(array_length(v_no_abrio, 1), 0) > 0 THEN
    v_titulo := 'Asueto (' || v_asueto || '): ' || v_abiertas || ' de '
                || (v_estado->>'total') || ' salas hicieron su apertura de caja';
    v_cuerpo := 'Hoy es asueto, así que no se espera que abran todas. '
             || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
                     THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
                     ELSE '' END
             || 'Abrieron: ' || v_lista;
    -- Nadie quedó acusado: no hay seguimiento de «abrió tarde».
    v_no_abrio := '{}'::text[];
    v_no_abrio_ids := '{}'::integer[];
  ELSE
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
  END IF;

  -- SÓLO Supervisor/a de Ventas: lo pidió en primera persona, y es una
  -- vigilancia de operación, no el informe de gerencia que es el cierre del día.
  v_dest := public.destinatarios_de_aperturas();
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
      'sin_respuesta', to_jsonb(v_sin_resp),
      'asueto',        v_asueto),
    -- Push SIEMPRE (2026-09-23): «si no entro no me entero». Uno por mañana.
    true,
    NULL
  );

  -- La marca sólo si algo se mandó de verdad. Escribirla igual dejaría el aviso
  -- del día apagado para siempre por una corrida que no llegó a nadie.
  IF coalesce(v_n, 0) > 0 THEN
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;

    -- Una marca por sala acusada: es lo que despierta el seguimiento
    -- (`avisar_apertura_tardia`) cuando esa sala abra.
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT 'APERTURA_FALTO:' || v_fecha::text || ':' || b, NULL
      FROM unnest(v_no_abrio_ids) b
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN coalesce(v_n, 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_aperturas_de_la_manana(date, boolean, integer[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_aperturas_de_la_manana(date, boolean, integer[]) TO service_role;

-- ── El seguimiento: la sala acusada ya abrió ────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_apertura_tardia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_tarde  text := 'APERTURA_TARDE:' || NEW.abierta_el::text || ':' || NEW.branch_id;
  v_sala   text;
  v_quien  text;
  v_estado jsonb;
  v_dest   uuid[];
  v_es_tarde boolean;
  v_titulo text;
BEGIN
  -- Sólo hoy y sólo la sala que el aviso de la mañana acusó.
  IF NEW.abierta_el <> v_hoy OR NEW.abierta_a IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                  WHERE a.clave = 'APERTURA_FALTO:' || NEW.abierta_el::text || ':' || NEW.branch_id
                    AND a.recipient_id IS NULL) THEN
    RETURN NULL;
  END IF;
  -- Una vez por sala y día. La marca va ANTES del aviso: si el sync inserta
  -- dos aperturas de la misma sala en la misma corrida, la segunda la encuentra.
  INSERT INTO public.avisos_emitidos (clave, recipient_id)
  VALUES (v_tarde, NULL)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_dest := public.destinatarios_de_aperturas();
  IF v_dest IS NULL THEN RETURN NULL; END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
  SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name)
    INTO v_quien
    FROM public.caja_aperturas_del_portal pp
    JOIN public.employees e ON e.id = pp.abierta_por
   WHERE pp.branch_id = NEW.branch_id AND pp.erp_apertura_id = NEW.erp_apertura_id
   LIMIT 1;

  -- La tarjeta pinta el estado del día completo: se recalcula con esta fila.
  v_estado := public.aperturas_de_la_manana(NEW.abierta_el);
  v_es_tarde := NEW.abierta_a > time '07:00';

  v_titulo := coalesce(v_sala, 'La sala') || ' hizo su apertura a las '
              || public.hora_12(NEW.abierta_a)
              || CASE WHEN v_es_tarde THEN ' (tarde)' ELSE '' END;

  PERFORM public.notify_employees(
    v_dest,
    'APERTURAS_DE_LA_MANANA',
    v_titulo,
    'Esta mañana ' || coalesce(v_sala, 'la sala') || ' no había hecho su apertura a la hora del aviso. '
      || 'La hizo a las ' || public.hora_12(NEW.abierta_a)
      || coalesce(' (' || v_quien || ')', ' desde la caja') || '.',
    '/caja?pestana=cortes',
    jsonb_build_object(
      'fecha',         NEW.abierta_el,
      'hora_aviso',    to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI'),
      'forzado',       false,
      'seguimiento',   true,
      'branch_id',     NEW.branch_id,
      'total',         (v_estado->>'total')::int,
      'abiertas',      (v_estado->>'abiertas')::int,
      'salas',         v_estado->'salas',
      'no_abrieron',   v_estado->'faltan',
      'sin_respuesta', '[]'::jsonb),
    true,
    NULL
  );

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_apertura_tardia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cortes_caja_aperturas_aviso_tardia ON public.cortes_caja_aperturas;
CREATE TRIGGER cortes_caja_aperturas_aviso_tardia
  AFTER INSERT ON public.cortes_caja_aperturas
  FOR EACH ROW EXECUTE FUNCTION public.avisar_apertura_tardia();
