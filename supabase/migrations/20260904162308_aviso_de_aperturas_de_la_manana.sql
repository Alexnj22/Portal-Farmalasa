SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- EL AVISO DE LA MAÑANA: quién abrió la caja de cada sala y a qué hora.
--
-- Lo pidió el usuario así: «al todas las sucursales por la mañana aperturar,
-- enviame una notificación con la hora y quien aperturó. todas abren a las
-- 7 am, si son las 7:20 y alguna no ha aperturado igual mandalo y dime cual
-- no ha aperturado».
--
-- O sea DOS disparadores para UN aviso: se manda cuando la última sala abre,
-- y si a las 7:20 alguna no abrió se manda igual nombrándola. Es la misma
-- forma que `avisar_cierre_del_dia` —esperar a que estén todas, y un cron de
-- hora tope que fuerza— y por eso se copia su estructura en vez de inventar
-- otra.
--
-- ── Por qué «quién abrió» NO sale de `empleado_texto` ───────────────────────
-- El panel del sistema de la caja trae un «Nombre» que es el de la CUENTA con
-- la que la sala opera, no el de quien actuó: en tres salas ni siquiera es una
-- persona («MI CAJA LA POPULAR») y en las otras tres es una que tampoco abrió.
-- Medido el 2026-09-03 sobre las seis aperturas del día: las SEIS nombraban a
-- quien no fue.
--
-- `cortes_caja_aperturas.employee_id` tampoco alcanza sola, y ésta es la parte
-- que se olvida: esa columna se llena de DOS fuentes distintas —la fila del
-- portal (observación directa de quién apretó el botón) o un cruce por texto
-- contra el nombre de la cuenta (una coincidencia)—. Medido el 2026-09-02, que
-- es el día antes de que el portal abriera cajas: Salud 1 decía «Nathaly
-- Estrada» y Salud 4 «Elizabeth Callejas» por el cruce, sin que nadie hubiera
-- visto a esas personas abrir nada.
--
-- Un aviso cuyo tema ES quién abrió no puede mezclar las dos. Acá se nombra
-- SÓLO cuando hay fila en `caja_aperturas_del_portal` amarrada por
-- `erp_apertura_id`; sin ella el aviso dice «se abrió desde la caja», que es
-- verdad, en vez de un nombre plausible que nadie va a revisar.
--
-- ── Por qué hace falta refrescar ANTES de decidir ──────────────────────────
-- `sync-aperturas-caja` corre cada 30 minutos, así que a las 7:20 la tabla
-- todavía tiene la foto de las 7:00. Medido el 2026-09-04: Salud 2 abrió 7:05
-- y Salud 3 a las 7:10, y sus filas nacieron a las 7:30 — un aviso construido
-- sobre la tabla a las 7:20 habría acusado a DOS salas que ya estaban
-- abiertas. Por eso quien dispara esto es la propia edge function, que primero
-- vuelve a preguntarle al origen por las salas que le faltan. Es
-- «cero filas: no miré ≠ no había».
--
-- ── Y por eso existe `p_sin_respuesta` ─────────────────────────────────────
-- Si el origen no contesta por una sala, esa sala no «no abrió»: no se pudo
-- comprobar. Sin esa distinción, un rato de origen caído a las 7:20 sale como
-- seis salas cerradas — la falsa alarma más grande que este aviso puede dar, y
-- la que lo haría dejar de leerse.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. El nombre corto, gemelo de `shortEmployeeName` ──────────────────────
--
-- `src/utils/nameUtils.js` es el original y manda: el portal muestra SIEMPRE
-- primer nombre + primer apellido. Hasta hoy no existía del lado de SQL, así
-- que un aviso escrito en la base ponía el nombre legal completo («EDWIN
-- ALEXANDER NUNEZ JOYA» al lado de un avatar que dice «EN») o se escribía la
-- regla a mano una vez más. Es la tercera copia lo que hay que evitar, no la
-- segunda: acá está nombrada y se puede enfrentar contra la de JavaScript.
--
-- Enfrentadas el 2026-09-04 sobre 15 casos —incluidos los espacios dobles, la
-- ficha sin nombres y el nombre concatenado de 1, 2, 3 y 4 palabras—:
-- IGUALES, 0 distintas.
--
-- La rama de `p_full` reproduce el heurístico del original —palabra 1 y
-- palabra 3— y por el mismo motivo es el ÚLTIMO recurso: partir el nombre
-- concatenado es adivinar dónde estaba la frontera. Hoy no se usa (las 48
-- fichas activas tienen las dos columnas), y está para que el gemelo sea el
-- mismo y no uno parecido.
CREATE OR REPLACE FUNCTION public.nombre_corto_de_empleado(
  p_first text, p_last text, p_full text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $fn$
  -- `regexp_replace(...,'\s+',' ','g')` y no `split_part` a secas: JavaScript
  -- parte por `/\s+/`, así que dos espacios seguidos son UN separador. Con
  -- `split_part` sobre el texto crudo, «ANA  MARIA» daría cadena vacía.
  WITH t AS (
    SELECT split_part(regexp_replace(btrim(coalesce(p_first, '')), '\s+', ' ', 'g'), ' ', 1) AS f,
           split_part(regexp_replace(btrim(coalesce(p_last,  '')), '\s+', ' ', 'g'), ' ', 1) AS l,
           regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g')                      AS n
  )
  SELECT CASE
    WHEN t.f <> '' OR t.l <> '' THEN btrim(t.f || ' ' || t.l)
    WHEN t.n = ''               THEN 'Personal'
    WHEN array_length(string_to_array(t.n, ' '), 1) <= 2 THEN t.n
    ELSE (string_to_array(t.n, ' '))[1] || ' ' || (string_to_array(t.n, ' '))[3]
  END
  FROM t;
$fn$;

COMMENT ON FUNCTION public.nombre_corto_de_empleado(text, text, text) IS
  'Primer nombre + primer apellido. Gemelo de shortEmployeeName (src/utils/nameUtils.js): cambiar uno exige cambiar el otro y volver a enfrentarlos.';

REVOKE EXECUTE ON FUNCTION public.nombre_corto_de_empleado(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nombre_corto_de_empleado(text, text, text) TO authenticated, service_role;


-- ── 2. El estado de la mañana ──────────────────────────────────────────────
--
-- Una sola lectura que contesta las tres preguntas que hacen falta: cuáles
-- abrieron (con hora y persona), cuáles faltan, y si el aviso ya salió. La
-- edge function la usa para saber a qué salas volver a preguntarle, así que
-- devuelve `faltan_ids` además de los nombres: sin los ids tendría que cruzar
-- rótulos contra el mapa del origen, que es cruzar por texto otra vez.
CREATE OR REPLACE FUNCTION public.aperturas_de_la_manana(p_fecha date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_out   jsonb;
BEGIN
  WITH salas AS (
    -- Las salas son las del mapa del origen sin la bodega: bodega no vende ni
    -- abre caja, y contarla dejaría el aviso esperando una apertura que no va
    -- a existir. Mismo criterio que `avisar_cierre_del_dia`.
    SELECT b.id AS branch_id, b.name AS sala
      FROM public.branches b
      JOIN public.erp_sucursal_map em ON em.branch_id = b.id AND NOT em.es_bodega
  ),
  primera AS (
    -- La PRIMERA apertura del día de cada sala: la de la mañana. Las de los
    -- turnos siguientes son relevos y no son de lo que habla este aviso.
    SELECT DISTINCT ON (a.branch_id)
           a.branch_id, a.erp_apertura_id, a.abierta_a, a.monto_apertura
      FROM public.cortes_caja_aperturas a
     WHERE a.abierta_el = v_fecha
     ORDER BY a.branch_id, a.abierta_a, a.erp_apertura_id
  ),
  filas AS (
    SELECT s.branch_id, s.sala, p.abierta_a, p.monto_apertura,
           pp.abierta_por AS employee_id,
           -- Sólo cuando el portal vio el acto. Ver el encabezado: sin fila del
           -- portal el nombre que hay es el de la cuenta, y ése no se pinta.
           -- El `CASE` es lo que hace que la ausencia llegue como NULL: llamar a
           -- `nombre_corto_de_empleado` con la ficha vacía devolvería 'Personal',
           -- que es un nombre y se leería como una respuesta.
           CASE WHEN e.id IS NOT NULL
                THEN public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name)
                END AS quien
      FROM salas s
      LEFT JOIN primera p ON p.branch_id = s.branch_id
      LEFT JOIN public.caja_aperturas_del_portal pp
             ON pp.branch_id = p.branch_id AND pp.erp_apertura_id = p.erp_apertura_id
      LEFT JOIN public.employees e ON e.id = pp.abierta_por
  )
  SELECT jsonb_build_object(
    'fecha',      v_fecha,
    'total',      count(*),
    'abiertas',   count(*) FILTER (WHERE abierta_a IS NOT NULL),
    'faltan_ids', coalesce(jsonb_agg(branch_id ORDER BY sala) FILTER (WHERE abierta_a IS NULL), '[]'::jsonb),
    'faltan',     coalesce(jsonb_agg(sala      ORDER BY sala) FILTER (WHERE abierta_a IS NULL), '[]'::jsonb),
    'salas',      coalesce(jsonb_agg(jsonb_build_object(
                    'branch_id',   branch_id,
                    'sala',        sala,
                    'hora',        to_char(abierta_a, 'HH24:MI'),
                    'employee_id', employee_id,
                    -- `quien` ausente NO es «no sé el nombre»: es «el portal no
                    -- vio quién fue». La tarjeta y el texto lo dicen distinto.
                    'quien',       quien,
                    'monto',       monto_apertura)
                    ORDER BY abierta_a, sala)
                  FILTER (WHERE abierta_a IS NOT NULL), '[]'::jsonb),
    'ya_avisado', EXISTS (SELECT 1 FROM public.avisos_emitidos a
                           WHERE a.clave = 'APERTURAS_MANANA:' || v_fecha::text)
  ) INTO v_out
  FROM filas;

  RETURN v_out;
END;
$fn$;

COMMENT ON FUNCTION public.aperturas_de_la_manana(date) IS
  'Cómo abrió la mañana: hora y persona por sala, cuáles faltan y si el aviso ya salió.';

-- Sólo `service_role`: es SECURITY DEFINER y devuelve las seis salas enteras,
-- o sea que salta el RLS. Hoy la llaman la edge function y el aviso, las dos
-- del lado del servidor. El día que la quiera una pantalla, la decisión es
-- pasarla a INVOKER — no agregarle un GRANT.
REVOKE EXECUTE ON FUNCTION public.aperturas_de_la_manana(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.aperturas_de_la_manana(date) TO service_role;


-- ── 3. El aviso ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_aperturas_de_la_manana(
  p_fecha         date      DEFAULT NULL,
  p_forzado       boolean   DEFAULT false,
  p_sin_respuesta integer[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_fecha    date    := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave    text    := 'APERTURAS_MANANA:' || v_fecha::text;
  v_estado   jsonb;
  v_hora     text    := to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI');
  v_abiertas integer;
  v_sin_resp text[];
  v_no_abrio text[];
  v_lista    text;
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

  -- Lo que no contestó el origen se separa de lo que no abrió. Ver el
  -- encabezado: no distinguirlos convierte un rato de origen caído en seis
  -- salas acusadas de no abrir.
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
           (s.value->>'sala') || ' ' || (s.value->>'hora') || ' ' ||
           coalesce(s.value->>'quien', 'desde la caja'), ' · ' ORDER BY s.n)
    INTO v_lista
    FROM jsonb_array_elements(v_estado->'salas') WITH ORDINALITY s(value, n);

  v_titulo := CASE
    WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1 THEN '⚠️ ' || v_no_abrio[1] || ' no ha abierto caja'
    WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1 THEN '⚠️ ' || coalesce(array_length(v_no_abrio, 1), 0) || ' salas no han abierto caja'
    WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0 THEN '⚠️ No se pudo comprobar si ' ||
           array_to_string(v_sin_resp, ', ') || ' abrió caja'
    ELSE 'Las ' || v_abiertas || ' salas abrieron caja'
  END;

  v_cuerpo :=
       CASE WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
            THEN 'A las ' || v_hora || ' todavía no abría ' || v_no_abrio[1] || '. '
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
            THEN 'A las ' || v_hora || ' todavía no abrían ' ||
                 array_to_string(v_no_abrio, ', ') || '. '
            ELSE '' END
    || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
            ELSE '' END
    || CASE WHEN v_abiertas = 0 THEN 'Ninguna sala había abierto.'
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'Abrieron: ' || v_lista
            ELSE v_lista END;

  -- Los dos cargos que el usuario nombró para el cierre del día, y por el mismo
  -- motivo: por ROL y no por una lista de ids, así el día que cambie la persona
  -- el aviso la alcanza sola.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
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
    -- Push SÓLO cuando falta una sala: eso es una tarea, y a las 7 de la mañana
    -- alguien tiene que ir a ver. El resumen de un día normal va a la campana y
    -- no al teléfono — un push que todas las mañanas dice «todo bien» es el que
    -- enseña a ignorar los push.
    coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0,
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
$fn$;

COMMENT ON FUNCTION public.avisar_aperturas_de_la_manana(date, boolean, integer[]) IS
  'El aviso de la mañana: sale cuando abrió la última sala, o forzado a la hora tope nombrando a las que faltan.';

REVOKE EXECUTE ON FUNCTION public.avisar_aperturas_de_la_manana(date, boolean, integer[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_aperturas_de_la_manana(date, boolean, integer[]) TO service_role;
