-- Login: tope de intentos atómico y cargos de administración sin carné
-- (2026-11-23, auditoría del login; aprobado por el usuario).
--
-- 1. `login_intento_reservar`: la edge function `ensure_user_by_code` contaba
--    los fallos y anotaba el nuevo DESPUÉS y sin esperar, así que una ráfaga
--    paralela pasaba entera el tope; y si la tabla fallaba, el tope quedaba
--    abierto. Ahora el intento se RESERVA antes de mirar nada, serializado por
--    IP con un candado de transacción: el pedido 16 ya ve las 15 reservas. La
--    función devuelve el id de la reserva (la edge la borra si el intento no fue
--    un fallo de credencial) o NULL si no hay lugar.
--    Topes: 15 por IP en 10 minutos (el de siempre) y, sólo para el diagnóstico
--    de usuario (`p_tope_red`), 300 en toda la red. Medido en producción
--    (login_rate_limit, 16–23 nov): el máximo de la red en 10 minutos fue 10 y
--    el de una IP, 3. El carné no lleva tope de red: le permitiría a un extraño
--    dejar sin entrar a todas las sucursales a la hora de entrada.
-- 2. `empleado_es_de_administracion`: los cargos de `cargos_de_administracion()`
--    no entran por carné; mira cargo principal, secundario y el de apoyo vigente.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.login_intento_reservar(p_ip text, p_tope_red boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ip  text := coalesce(nullif(p_ip, ''), 'unknown');
  v_n   int;
  v_red int;
  v_id  bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('login_rl:' || v_ip, 0));

  SELECT count(*) INTO v_n FROM public.login_rate_limit
   WHERE client_ip = v_ip AND created_at > now() - interval '10 minutes';
  IF v_n >= 15 THEN RETURN NULL; END IF;

  IF p_tope_red THEN
    SELECT count(*) INTO v_red FROM public.login_rate_limit
     WHERE created_at > now() - interval '10 minutes';
    IF v_red >= 300 THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO public.login_rate_limit (client_ip) VALUES (v_ip) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.login_intento_reservar(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_intento_reservar(text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.empleado_es_de_administracion(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.employees e
      JOIN public.roles r
        ON r.id IN (e.role_id, e.secondary_role_id, public.cargo_de_apoyo_vigente(e.id))
     WHERE e.id = p_employee_id
       AND r.name = ANY (public.cargos_de_administracion())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.empleado_es_de_administracion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empleado_es_de_administracion(uuid) TO service_role;
