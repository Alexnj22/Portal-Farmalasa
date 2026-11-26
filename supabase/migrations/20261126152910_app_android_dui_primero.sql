SET lock_timeout = '5s';

-- Portal sólo en computadora, Android (2026-11-26, pedido del usuario): antes
-- del correo se pide el DUI, y sólo un empleado ACTIVO puede dejar su correo.
-- Así nadie que no sea del personal manda un correo a la lista de la prueba.
--
-- Las dos son de `anon` (la pantalla sale antes de iniciar sesión):
--   · app_android_dui(dui) → 'no_empleado' | 'lista' | 'esperando' | 'pedir_correo'
--   · app_android_registrar(dui, correo) → 'no_empleado' | 'lista' | 'esperando'
-- No devuelven nombres ni correos. A diferencia de `novedades_correo_android`
-- (con sesión), NO tocan la ficha de empleado ni la de cliente: sin sesión
-- sólo se deja la fila en la lista, y un correo que ya se agregó en Google
-- Play no se cambia desde aquí (eso se hace con sesión, en Novedades).

CREATE OR REPLACE FUNCTION public.app_android_dui(p_dui text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_dui text := regexp_replace(coalesce(p_dui, ''), '\D', '', 'g');
  v_emp uuid;
  v_fila record;
BEGIN
  IF length(v_dui) <> 9 THEN RETURN 'no_empleado'; END IF;
  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = v_dui
   LIMIT 1;
  IF v_emp IS NULL THEN RETURN 'no_empleado'; END IF;
  SELECT agregado_at INTO v_fila FROM public.app_pruebas_android WHERE employee_id = v_emp;
  IF NOT FOUND THEN RETURN 'pedir_correo'; END IF;
  RETURN CASE WHEN v_fila.agregado_at IS NOT NULL THEN 'lista' ELSE 'esperando' END;
END $$;

CREATE OR REPLACE FUNCTION public.app_android_registrar(p_dui text, p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_dui   text := regexp_replace(coalesce(p_dui, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_emp   uuid;
  v_agregado timestamptz;
BEGIN
  IF length(v_dui) <> 9 THEN RETURN 'no_empleado'; END IF;
  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = v_dui
   LIMIT 1;
  IF v_emp IS NULL THEN RETURN 'no_empleado'; END IF;
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'CORREO_INVALIDO';
  END IF;

  SELECT agregado_at INTO v_agregado FROM public.app_pruebas_android WHERE employee_id = v_emp;
  IF v_agregado IS NOT NULL THEN RETURN 'lista'; END IF;

  INSERT INTO public.app_pruebas_android (employee_id, email)
  VALUES (v_emp, v_email)
  ON CONFLICT (employee_id) DO UPDATE
     SET email = EXCLUDED.email, updated_at = now()
   WHERE app_pruebas_android.agregado_at IS NULL
     AND app_pruebas_android.email IS DISTINCT FROM EXCLUDED.email;
  RETURN 'esperando';
END $$;

REVOKE EXECUTE ON FUNCTION public.app_android_dui(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_android_registrar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_android_dui(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_android_registrar(text, text) TO anon, authenticated, service_role;
