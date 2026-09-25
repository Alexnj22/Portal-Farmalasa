SET lock_timeout = '5s';

-- ═══ Avisos sólo en horario laboral ═════════════════════════════════════════
-- Regla del usuario (2026-09-25): «está completamente prohibido avisos,
-- notificaciones en horarios no laborales. A las 8 am para admin y 7 am para
-- los demás. Y según cierre de sucursal (menos admin, ellos hasta las 11 pm).»
-- Decidido con él: vale para TODO el portal, y lo que nace fuera de horario
-- no se pierde — espera y se entrega cuando abre la ventana de esa persona.
-- Ni la campana ni el teléfono reciben nada fuera de la ventana.
--
-- Dónde se hace cumplir, y por qué ahí:
--   · la campana: un trigger BEFORE INSERT en `notifications`. Hay ~20
--     funciones que escriben ahí directo; un filtro en cada una se olvida en
--     la número 21. El trigger aparta la fila a `avisos_diferidos`.
--   · el teléfono: `send-push-notification`, que es por donde pasa TODO push
--     (notify_employees, push_de_notificaciones, comunicados, alertas de las
--     edge functions). Le pregunta a `avisos_filtrar_push` quién está en
--     horario y encola al resto.
--   · la entrega: `avisos_entregar_diferidos`, cron cada 5 minutos.
--
-- La ventana la decide UNA función, `aviso_ventana`: la usan el trigger, el
-- filtro del push y la entrega. Si contestaran distinto, un aviso podría
-- entrar a la cola y volver a encolarse para siempre.

-- ── La ventana ─────────────────────────────────────────────────────────────
-- NULL = está en horario, se entrega ya. Si no, cuándo abre su ventana.
--   · administración (Gerencia, Administración, Talento Humano, Supervisión de
--     Ventas, y las cuentas de sistema): 08:00–23:00 todos los días
--   · los demás: 07:00 hasta el cierre de SU sala ese día
--     (`sala_hora_de_cierre`). Sala cerrada ese día = sin avisos ese día.
--     Sin sala asignada: 07:00–17:00.
CREATE OR REPLACE FUNCTION public.aviso_ventana(p_employee uuid, p_ts timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c_tz     constant text := 'America/El_Salvador';
  v_local  timestamp := p_ts AT TIME ZONE c_tz;
  v_rol    integer;
  v_sala   bigint;
  v_admin  boolean;
  v_dia    date;
  v_abre   time;
  v_cierra time;
BEGIN
  SELECT e.role_id, e.branch_id INTO v_rol, v_sala FROM public.employees e WHERE e.id = p_employee;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_admin := v_rol IN (2, 3, 11, 13, 33, 34, 36);

  FOR d IN 0..14 LOOP
    v_dia := v_local::date + d;
    IF v_admin THEN
      v_abre := time '08:00'; v_cierra := time '23:00';
    ELSE
      v_abre := time '07:00';
      v_cierra := CASE WHEN v_sala IS NULL THEN time '17:00'
                       ELSE public.sala_hora_de_cierre(v_sala, v_dia) END;
    END IF;
    CONTINUE WHEN v_cierra IS NULL OR v_cierra <= v_abre;
    IF v_local < v_dia + v_abre THEN
      RETURN (v_dia + v_abre) AT TIME ZONE c_tz;
    END IF;
    IF v_local < v_dia + v_cierra THEN
      RETURN NULL;
    END IF;
  END LOOP;
  -- Dos semanas sin ventana es un dato roto, no un horario: entregar antes
  -- que retener un aviso para siempre.
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aviso_ventana(uuid, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aviso_ventana(uuid, timestamptz) TO authenticated, service_role;

-- ── La cola ────────────────────────────────────────────────────────────────
-- `notificacion`: la fila de la campana tal como iba a entrar (con su id).
-- `push`: un envío al teléfono sin fila de campana (comunicados, alertas).
-- `con_push`: la fila de campana además iba al teléfono; se manda al entregar.
-- Se conserva lo entregado 30 días: un aviso que llegó a las 7:00 tiene que
-- poder explicar a qué hora nació.
CREATE TABLE IF NOT EXISTS public.avisos_diferidos (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entregar_en   timestamptz NOT NULL,
  notificacion  jsonb,
  push          jsonb,
  con_push      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  entregado_at  timestamptz,
  CONSTRAINT avisos_diferidos_algo CHECK (notificacion IS NOT NULL OR push IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS avisos_diferidos_pendientes ON public.avisos_diferidos (entregar_en) WHERE entregado_at IS NULL;
CREATE INDEX IF NOT EXISTS avisos_diferidos_employee ON public.avisos_diferidos (employee_id);
CREATE INDEX IF NOT EXISTS avisos_diferidos_notificacion
  ON public.avisos_diferidos (((notificacion->>'id')::uuid)) WHERE entregado_at IS NULL AND notificacion IS NOT NULL;

ALTER TABLE public.avisos_diferidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS avisos_diferidos_select ON public.avisos_diferidos;
CREATE POLICY avisos_diferidos_select ON public.avisos_diferidos FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id()));
REVOKE ALL ON public.avisos_diferidos FROM anon;

-- ── La campana ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisos_horario_notificacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_abre timestamptz;
BEGIN
  -- La entrega de la cola ya decidió que es hora.
  IF current_setting('avisos.entregando', true) = 'on' THEN RETURN NEW; END IF;
  v_abre := public.aviso_ventana(NEW.recipient_id, now());
  IF v_abre IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.avisos_diferidos (employee_id, entregar_en, notificacion, con_push)
  VALUES (NEW.recipient_id, v_abre, to_jsonb(NEW), coalesce(current_setting('avisos.con_push', true), '') = 'on');
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.avisos_horario_notificacion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS avisos_horario ON public.notifications;
CREATE TRIGGER avisos_horario BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.avisos_horario_notificacion();

-- ── notify_employees: el push sólo a quien recibió la campana ──────────────
-- La fila apartada lleva `con_push` y su teléfono suena al entregarse.
-- Devuelve a cuántos se avisó (ya o al abrir su ventana), como antes.
CREATE OR REPLACE FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false, p_branch_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_targets uuid[];
  v_ya uuid[];
BEGIN
  SELECT array_agg(DISTINCT e.id) INTO v_targets
  FROM public.employees e
  WHERE e.id = ANY(p_recipients)
    AND (v_actor IS NULL OR e.id <> v_actor);

  IF v_targets IS NULL THEN RETURN 0; END IF;

  PERFORM set_config('avisos.con_push', CASE WHEN p_push THEN 'on' ELSE '' END, true);
  WITH ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT t, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
    FROM unnest(v_targets) t
    RETURNING recipient_id
  )
  SELECT array_agg(recipient_id) INTO v_ya FROM ins;
  PERFORM set_config('avisos.con_push', '', true);

  IF p_push AND v_ya IS NOT NULL THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title', p_title,
        -- La línea corta del teléfono (24-sep); sin datos, el cuerpo de siempre.
        'message', public.texto_de_push(p_type, COALESCE(p_body, ''), p_metadata),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'EMPLOYEE',
        'target_value', to_jsonb(v_ya)
      )
    );
  END IF;

  RETURN cardinality(v_targets);
END;
$function$;

-- ── push_de_notificaciones: las filas apartadas se llevan su push ──────────
CREATE OR REPLACE FUNCTION public.push_de_notificaciones(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- Manda al teléfono avisos que YA están en la campana. Recibe los ids de las
-- filas de `notifications` y agrupa por (título, cuerpo, enlace): los que
-- dicen lo mismo salen en un solo envío, los distintos (p. ej. uno por sala)
-- en envíos separados. Existe para las funciones que escriben en
-- `notifications` directo en vez de pasar por `notify_employees`.
-- Las filas que el horario apartó (25-sep) no están en `notifications`: se
-- marcan en la cola y su teléfono suena cuando se entregan.
DECLARE
  g   record;
  v_n integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  UPDATE public.avisos_diferidos SET con_push = true
   WHERE entregado_at IS NULL AND notificacion IS NOT NULL
     AND (notificacion->>'id')::uuid = ANY(p_ids) AND NOT con_push;
  FOR g IN
    -- Se agrupa por la LÍNEA que va al teléfono (24-sep) y no por el cuerpo:
    -- es lo que se manda, y dos avisos con el mismo texto salen en un envío.
    SELECT n.title, public.texto_de_push(n.type, n.body, n.metadata) AS body, n.link,
           array_agg(DISTINCT n.recipient_id) AS ids
      FROM public.notifications n
     WHERE n.id = ANY(p_ids)
     GROUP BY n.title, public.texto_de_push(n.type, n.body, n.metadata), n.link
  LOOP
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title',        g.title,
        'message',      coalesce(g.body, ''),
        'url',          coalesce(g.link, '/home'),
        'target_type',  'EMPLOYEE',
        'target_value', to_jsonb(g.ids)));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── El teléfono: lo llama send-push-notification ───────────────────────────
-- Recibe los empleados a los que iba el envío y devuelve los que están en
-- horario; al resto le deja el envío en la cola.
CREATE OR REPLACE FUNCTION public.avisos_filtrar_push(p_ids uuid[], p_payload jsonb)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id   uuid;
  v_abre timestamptz;
  v_ok   uuid[] := '{}';
  v_push jsonb := coalesce(p_payload, '{}'::jsonb) - 'target_type' - 'target_value';
BEGIN
  FOREACH v_id IN ARRAY coalesce(p_ids, '{}') LOOP
    v_abre := public.aviso_ventana(v_id, now());
    IF v_abre IS NULL THEN
      v_ok := v_ok || v_id;
    ELSE
      INSERT INTO public.avisos_diferidos (employee_id, entregar_en, push)
      VALUES (v_id, v_abre, v_push);
    END IF;
  END LOOP;
  RETURN v_ok;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.avisos_filtrar_push(uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisos_filtrar_push(uuid[], jsonb) TO service_role;

-- ── La entrega ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisos_entregar_diferidos()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_con_push uuid[];
  v_campana  integer;
  v_push     integer := 0;
  g          record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _avisos_entrega (LIKE public.avisos_diferidos) ON COMMIT DROP;
  TRUNCATE _avisos_entrega;

  WITH due AS (
    UPDATE public.avisos_diferidos SET entregado_at = now()
     WHERE entregado_at IS NULL AND entregar_en <= now()
    RETURNING *
  )
  INSERT INTO _avisos_entrega SELECT * FROM due;

  -- La campana: la fila tal como nació, con la hora de entrega (así queda
  -- arriba y el aviso en tiempo real salta) y la de origen en `metadata`.
  PERFORM set_config('avisos.entregando', 'on', true);
  INSERT INTO public.notifications
  SELECT (jsonb_populate_record(NULL::public.notifications,
            d.notificacion || jsonb_build_object(
              'created_at', now(),
              'metadata', coalesce(d.notificacion->'metadata', '{}'::jsonb)
                          || jsonb_build_object('nacio_el', d.notificacion->>'created_at')))).*
    FROM _avisos_entrega d
   WHERE d.notificacion IS NOT NULL
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_campana = ROW_COUNT;
  PERFORM set_config('avisos.entregando', '', true);

  SELECT array_agg((notificacion->>'id')::uuid) INTO v_con_push
    FROM _avisos_entrega WHERE notificacion IS NOT NULL AND con_push;
  IF v_con_push IS NOT NULL THEN
    v_push := v_push + public.push_de_notificaciones(v_con_push);
  END IF;

  -- Los envíos sin campana: uno por contenido, a todos los que lo esperaban.
  FOR g IN
    SELECT push, array_agg(DISTINCT employee_id) AS ids
      FROM _avisos_entrega WHERE push IS NOT NULL GROUP BY push
  LOOP
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := g.push || jsonb_build_object('target_type', 'EMPLOYEE', 'target_value', to_jsonb(g.ids)));
    v_push := v_push + 1;
  END LOOP;

  DELETE FROM public.avisos_diferidos WHERE entregado_at < now() - interval '30 days';

  RETURN json_build_object('campana', v_campana, 'envios', v_push);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.avisos_entregar_diferidos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisos_entregar_diferidos() TO service_role;

-- ── El cron ────────────────────────────────────────────────────────────────
-- Guarda «sólo si existe» (regla del branch de pruebas).
SELECT cron.unschedule('avisos-diferidos-5min')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-diferidos-5min');
SELECT cron.schedule('avisos-diferidos-5min', '*/5 * * * *', $c$SELECT public.avisos_entregar_diferidos()$c$);
