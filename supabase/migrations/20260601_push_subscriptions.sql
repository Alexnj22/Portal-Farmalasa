-- Web Push subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_employee_idx ON public.push_subscriptions(employee_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Employees can only manage their own subscriptions
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions
  FOR ALL USING (
    employee_id = (
      SELECT id FROM public.employees WHERE auth_user_id = auth.uid()
    )
  );

-- Service role bypass for edge function reads
CREATE POLICY "push_subscriptions_service" ON public.push_subscriptions
  FOR SELECT USING (auth.role() = 'service_role');

-- Trigger: fire push notification on new announcement
CREATE OR REPLACE FUNCTION public.notify_push_on_announcement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  fn_url text;
  payload jsonb;
BEGIN
  -- Skip archived or future-scheduled announcements
  IF NEW.is_archived THEN RETURN NEW; END IF;
  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for > now() THEN RETURN NEW; END IF;

  fn_url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/send-push-notification';

  payload := jsonb_build_object(
    'announcement_id', NEW.id,
    'title',           CASE WHEN NEW.priority = 'URGENT' THEN 'Aviso urgente — Farmalasa' ELSE 'Nuevo aviso — Farmalasa' END,
    'message',         COALESCE(NEW.title, 'Tienes un aviso nuevo'),
    'url',             '/my-announcements',
    'urgent',          (NEW.priority = 'URGENT'),
    'target_type',     NEW.target_type,
    'target_value',    NEW.target_value
  );

  PERFORM net.http_post(
    url     := fn_url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := payload
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_announcement ON public.announcements;
CREATE TRIGGER trg_push_on_announcement
  AFTER INSERT ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_announcement();
