SET lock_timeout = '5s';

-- Los avisos llegan también a la APP del teléfono (2026-09-29, pedido del
-- usuario: «notificaciones nativas»).
--
-- `push_subscriptions` es del navegador: guarda la suscripción de web push
-- (endpoint + llaves VAPID). El teléfono no tiene eso: tiene un TOKEN que
-- entrega el sistema (Expo lo traduce a APNs en iPhone y FCM en Android). Son
-- dos canales distintos con dos formas distintas, así que van en dos tablas;
-- `send-push-notification` manda por los dos con el MISMO filtro de
-- destinatarios y el MISMO horario laboral (`avisos_filtrar_push`).
--
-- El dueño del token es quien tiene la sesión abierta en ese teléfono, igual
-- que `reclamar_push_del_equipo`: el empleado NUNCA llega por parámetro, sale
-- de `auth_employee_id()`. Si otra persona entra en el mismo teléfono, el token
-- pasa a ella, y al salir se suelta.

CREATE TABLE IF NOT EXISTS public.push_dispositivos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  plataforma  text NOT NULL CHECK (plataforma IN ('ios', 'android')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_dispositivos_employee_id_idx ON public.push_dispositivos (employee_id);

ALTER TABLE public.push_dispositivos ENABLE ROW LEVEL SECURITY;

-- Cada quien ve sus teléfonos. Las escrituras van SÓLO por las dos funciones de
-- abajo: no hay policy de INSERT/UPDATE/DELETE, así que desde el cliente nadie
-- puede ligar un token a otra persona.
DROP POLICY IF EXISTS push_dispositivos_select ON public.push_dispositivos;
CREATE POLICY push_dispositivos_select ON public.push_dispositivos
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id()));

REVOKE ALL ON public.push_dispositivos FROM anon;
GRANT SELECT ON public.push_dispositivos TO authenticated;
GRANT ALL ON public.push_dispositivos TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_dispositivo_push(p_token text, p_plataforma text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 10 OR length(p_token) > 300 THEN
    RAISE EXCEPTION 'Token de aviso inválido';
  END IF;
  IF p_plataforma NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Plataforma inválida';
  END IF;

  v_emp := public.auth_employee_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No hay empleado para la sesión actual';
  END IF;

  -- Corre en cada arranque de la app: sin el WHERE reescribiría la fila siempre.
  INSERT INTO public.push_dispositivos AS d (employee_id, token, plataforma)
  VALUES (v_emp, p_token, p_plataforma)
  ON CONFLICT (token) DO UPDATE
     SET employee_id = EXCLUDED.employee_id,
         plataforma  = EXCLUDED.plataforma,
         updated_at  = now()
   WHERE (d.employee_id, d.plataforma) IS DISTINCT FROM (EXCLUDED.employee_id, EXCLUDED.plataforma);
END;
$$;

-- Al salir de la app se suelta el teléfono, sea de quien sea la fila: sólo lo
-- puede pedir quien tiene el token, que es quien tiene el teléfono en la mano.
CREATE OR REPLACE FUNCTION public.soltar_dispositivo_push(p_token text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions
AS $$
  DELETE FROM public.push_dispositivos WHERE token = p_token;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_dispositivo_push(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_dispositivo_push(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.soltar_dispositivo_push(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soltar_dispositivo_push(text) TO authenticated, service_role;

COMMENT ON TABLE public.push_dispositivos IS
  'Teléfonos con la app: token de aviso (Expo → APNs/FCM) del empleado con la sesión abierta. Lo escribe registrar_dispositivo_push / soltar_dispositivo_push; lo lee send-push-notification.';
