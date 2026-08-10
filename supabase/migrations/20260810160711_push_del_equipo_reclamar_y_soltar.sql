SET lock_timeout = '5s';

-- El aviso del sistema (web push) es del EQUIPO, no de la cuenta: el `endpoint`
-- lo emite el navegador de esa computadora y la columna es UNIQUE. En las
-- computadoras de mostrador —donde el turno cambia de persona y la máquina no—
-- eso dejaba la fila apuntando al PRIMERO que apretó «Activar» ahí, y cerrar
-- sesión no la soltaba. Tres consecuencias, las tres medidas en el código:
--
--  · Los avisos de quien ya se fue seguían cayendo en esa pantalla; el service
--    worker los muestra sin mirar quién tiene sesión abierta.
--  · El siguiente empleado no recibía ninguno de los suyos, y ni se enteraba:
--    el banner que ofrece activarlos se calla cuando el NAVEGADOR ya tiene
--    suscripción, que es justo el caso.
--  · Y no podía tomar el equipo aunque quisiera: `push_subscriptions_update`
--    valida la fila EXISTENTE, así que el upsert por `endpoint` de otro
--    empleado moría con error de RLS.
--
-- El dueño de la suscripción pasa a ser quien tiene la sesión abierta en ese
-- equipo. Las dos operaciones necesitan SECURITY DEFINER porque justamente
-- cruzan de un empleado a otro, que es lo que la RLS impide a propósito. El
-- empleado NUNCA llega por parámetro: sale de `auth_employee_id()`, o sea del
-- token de quien llama — nadie puede reclamar un equipo para otro.

CREATE OR REPLACE FUNCTION public.reclamar_push_del_equipo(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid;
BEGIN
  IF p_endpoint IS NULL OR p_p256dh IS NULL OR p_auth IS NULL THEN
    RAISE EXCEPTION 'Suscripción incompleta';
  END IF;

  v_emp := public.auth_employee_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No hay empleado para la sesión actual';
  END IF;

  -- El `WHERE` del DO UPDATE evita reescribir la fila cuando el equipo ya es de
  -- esta persona y la suscripción no cambió: esto corre en CADA inicio de
  -- sesión.
  INSERT INTO public.push_subscriptions AS ps (employee_id, endpoint, p256dh, auth)
  VALUES (v_emp, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE
     SET employee_id = EXCLUDED.employee_id,
         p256dh      = EXCLUDED.p256dh,
         auth        = EXCLUDED.auth,
         updated_at  = now()
   WHERE (ps.employee_id, ps.p256dh, ps.auth)
         IS DISTINCT FROM (EXCLUDED.employee_id, EXCLUDED.p256dh, EXCLUDED.auth);
END;
$$;

-- Suelta el equipo: al cerrar sesión en una computadora compartida no puede
-- quedar NADIE ligado a ese navegador. Borra la fila sea de quien sea, y tiene
-- que ser así — el caso que hay que limpiar es precisamente el de la fila que
-- dejó la persona anterior. No es una operación destructiva (deja de mandar
-- avisos a ese navegador, nada más) y sólo la puede pedir quien tiene el
-- `endpoint`, que es quien está sentado en esa máquina.
CREATE OR REPLACE FUNCTION public.soltar_push_del_equipo(p_endpoint text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions
AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
$$;

REVOKE EXECUTE ON FUNCTION public.reclamar_push_del_equipo(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reclamar_push_del_equipo(text, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.soltar_push_del_equipo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soltar_push_del_equipo(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.reclamar_push_del_equipo(text, text, text) IS
  'Liga la suscripción push de ESTE navegador al empleado de la sesión que llama (auth_employee_id). Se llama al iniciar sesión: en una computadora compartida el dueño del aviso es quien está adentro ahora.';

COMMENT ON FUNCTION public.soltar_push_del_equipo(text) IS
  'Desliga el navegador de cualquier empleado. Se llama al cerrar sesión en equipos no instalados como app: una computadora sin nadie adentro no le manda avisos a nadie.';
