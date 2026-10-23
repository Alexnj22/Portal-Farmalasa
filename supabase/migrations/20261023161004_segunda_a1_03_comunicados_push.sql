-- segunda-a1-03 · Comunicados: el push llega sólo a su audiencia, y también
-- el del programado (H9, H13)
-- H9: la audiencia se resuelve EN LA BASE con la regla del RLS y se manda siempre EMPLOYEE.
-- H13: `push_enviado_at` marca el envío; el cron de cada 5 min manda los programados.
SET lock_timeout = '5s';

ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS push_enviado_at timestamptz;

-- Lo ya publicado no se reenvía: se da por enviado. Los programados a futuro
-- quedan en NULL para que salgan a su hora.
UPDATE public.announcements
   SET push_enviado_at = coalesce(created_at, now())
 WHERE push_enviado_at IS NULL
   AND (scheduled_for IS NULL OR scheduled_for <= now());

-- La audiencia de un comunicado, con la regla del RLS (`announcements_audience`).
-- NULL = GLOBAL (todas las suscripciones). '{}' = nadie.
CREATE OR REPLACE FUNCTION public.audiencia_de_aviso(p_target_type text, p_target_value jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_vals text[];
    v_ids  uuid[];
BEGIN
    IF p_target_type = 'GLOBAL' THEN
        RETURN NULL;
    END IF;

    -- Escalar o arreglo: los dos formatos que hay en la tabla.
    IF jsonb_typeof(p_target_value) = 'array' THEN
        SELECT array_agg(x) INTO v_vals FROM jsonb_array_elements_text(p_target_value) x;
    ELSIF p_target_value IS NOT NULL AND jsonb_typeof(p_target_value) <> 'null' THEN
        v_vals := ARRAY[p_target_value #>> '{}'];
    END IF;
    IF coalesce(array_length(v_vals, 1), 0) = 0 THEN
        RETURN ARRAY[]::uuid[];
    END IF;

    IF p_target_type = 'EMPLOYEE' THEN
        SELECT array_agg(e.id) INTO v_ids
          FROM public.employees e WHERE e.id::text = ANY (v_vals);
    ELSIF p_target_type = 'BRANCH' THEN
        SELECT array_agg(e.id) INTO v_ids
          FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id::text = ANY (v_vals);
    ELSIF p_target_type = 'ROLE' THEN
        SELECT array_agg(e.id) INTO v_ids
          FROM public.employees e JOIN public.roles r ON r.id = e.role_id
         WHERE e.status = 'ACTIVO' AND r.name = ANY (v_vals);
    END IF;

    RETURN coalesce(v_ids, ARRAY[]::uuid[]);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audiencia_de_aviso(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audiencia_de_aviso(text, jsonb) TO service_role;

-- Manda el push de UN comunicado y lo marca. No hace nada si ya salió, si
-- está archivado o si todavía no es su hora.
CREATE OR REPLACE FUNCTION public.enviar_push_de_aviso(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    a     public.announcements;
    v_ids uuid[];
BEGIN
    SELECT * INTO a FROM public.announcements WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR a.is_archived OR a.push_enviado_at IS NOT NULL
       OR (a.scheduled_for IS NOT NULL AND a.scheduled_for > now()) THEN
        RETURN false;
    END IF;

    -- Se marca aunque no haya a quién: así el cron no lo vuelve a mirar.
    UPDATE public.announcements SET push_enviado_at = now() WHERE id = p_id;

    v_ids := public.audiencia_de_aviso(a.target_type, a.target_value);
    IF v_ids IS NOT NULL AND coalesce(array_length(v_ids, 1), 0) = 0 THEN
        RETURN false;
    END IF;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object(
            'announcement_id', a.id,
            'title',   COALESCE(a.title, 'Nuevo aviso'),
            'message', CASE WHEN a.priority = 'URGENT' THEN 'Aviso urgente · Portal Farmalasa' ELSE 'Nuevo aviso · Portal Farmalasa' END,
            'url',     '/my-announcements',
            'urgent',  (a.priority = 'URGENT'),
            'target_type',  CASE WHEN v_ids IS NULL THEN 'GLOBAL' ELSE 'EMPLOYEE' END,
            'target_value', CASE WHEN v_ids IS NULL THEN NULL ELSE to_jsonb(v_ids) END));
    RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enviar_push_de_aviso(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_push_de_aviso(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_push_on_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.is_archived OR NEW.push_enviado_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for > now() THEN RETURN NEW; END IF;
  PERFORM public.enviar_push_de_aviso(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_on_announcement ON public.announcements;
CREATE TRIGGER trg_push_on_announcement
    AFTER INSERT OR UPDATE OF scheduled_for, is_archived ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_announcement();

-- Los programados cuya hora llegó. Lo llama el cron de cada 5 minutos.
CREATE OR REPLACE FUNCTION public.avisos_programados_enviar_push()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r   record;
    v_n integer := 0;
BEGIN
    FOR r IN
        SELECT id FROM public.announcements
         WHERE push_enviado_at IS NULL AND NOT coalesce(is_archived, false)
           AND scheduled_for IS NOT NULL AND scheduled_for <= now()
         ORDER BY scheduled_for
         LIMIT 50
    LOOP
        IF public.enviar_push_de_aviso(r.id) THEN v_n := v_n + 1; END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisos_programados_enviar_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisos_programados_enviar_push() TO service_role;

CREATE INDEX IF NOT EXISTS announcements_push_pendiente_idx
    ON public.announcements (scheduled_for) WHERE push_enviado_at IS NULL;

-- `avisos_entregar_diferidos` (cron avisos-diferidos-5min): definición viva
-- del 2026-10-23 + una línea que manda los programados.
CREATE OR REPLACE FUNCTION public.avisos_entregar_diferidos()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Los comunicados programados cuya hora llegó (H13, 2026-10-23).
  v_push := v_push + public.avisos_programados_enviar_push();

  DELETE FROM public.avisos_diferidos WHERE entregado_at < now() - interval '30 days';

  RETURN json_build_object('campana', v_campana, 'envios', v_push);
END;
$function$;
