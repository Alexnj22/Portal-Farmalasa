-- Centraliza la URL de la edge function send-push-notification, hardcodeada
-- por separado en notify_employees, notify_branch y notify_push_on_announcement.

CREATE OR REPLACE FUNCTION public.push_function_url()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $function$
  SELECT 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/send-push-notification'::text;
$function$;

REVOKE EXECUTE ON FUNCTION public.push_function_url() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_function_url() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false, p_branch_id integer DEFAULT NULL::integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_targets uuid[];
  v_count integer;
BEGIN
  -- destinatarios válidos, sin duplicados, sin auto-notificarse
  SELECT array_agg(DISTINCT e.id) INTO v_targets
  FROM public.employees e
  WHERE e.id = ANY(p_recipients)
    AND (v_actor IS NULL OR e.id <> v_actor);

  IF v_targets IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
  SELECT t, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
  FROM unnest(v_targets) t;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
        'title', p_title,
        'message', COALESCE(p_body, ''),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'EMPLOYEE',
        'target_value', to_jsonb(v_targets)
      )
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_count integer;
BEGIN
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
  SELECT e.id, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
  FROM public.employees e
  WHERE e.branch_id = p_branch_id
    AND e.status = 'ACTIVO'
    AND (v_actor IS NULL OR e.id <> v_actor);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
        'title', p_title,
        'message', COALESCE(p_body, ''),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'BRANCH',
        'target_value', jsonb_build_array(p_branch_id)
      )
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_push_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  payload jsonb;
BEGIN
  IF NEW.is_archived THEN RETURN NEW; END IF;
  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for > now() THEN RETURN NEW; END IF;

  payload := jsonb_build_object(
    'announcement_id', NEW.id,
    'title',   COALESCE(NEW.title, 'Nuevo aviso'),
    'message', CASE WHEN NEW.priority = 'URGENT' THEN 'Aviso urgente · Portal Farmalasa' ELSE 'Nuevo aviso · Portal Farmalasa' END,
    'url',     '/my-announcements',
    'urgent',  (NEW.priority = 'URGENT'),
    'target_type',  NEW.target_type,
    'target_value', NEW.target_value
  );

  PERFORM net.http_post(
    url     := public.push_function_url(),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := payload
  );

  RETURN NEW;
END;
$function$;
