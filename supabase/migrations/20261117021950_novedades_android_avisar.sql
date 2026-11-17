-- Novedades · Android: al marcar a alguien como agregado en Google Play, la
-- persona recibe un aviso (campana + teléfono) con el enlace a sus pasos.
-- `novedades_android_avisar` sirve también para reenviarlo.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.novedades_android_avisar(p_empleados uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['novedades'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  FOR r IN
    SELECT a.employee_id, a.email
      FROM public.app_pruebas_android a
     WHERE a.employee_id = ANY (p_empleados) AND a.agregado_at IS NOT NULL
  LOOP
    v_n := v_n + public.notify_employees(
      ARRAY[r.employee_id],
      'APP_PERSONAL_LISTA',
      'Ya puedes descargar Portal Farmasalud',
      format('Tu correo %s ya está en Google Play. Toca aquí y sigue los pasos para instalarla.', r.email),
      '/novedades?app=android',
      jsonb_build_object('correo', r.email),
      true,
      NULL
    );
  END LOOP;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION public.novedades_android_avisar(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novedades_android_avisar(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.novedades_android_agregados(p_empleados uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_ids uuid[];
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['novedades'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  WITH m AS (
    UPDATE public.app_pruebas_android
       SET agregado_at = now(), agregado_por = public.auth_employee_id(), updated_at = now()
     WHERE employee_id = ANY (p_empleados) AND agregado_at IS NULL
    RETURNING employee_id
  )
  SELECT array_agg(employee_id) INTO v_ids FROM m;
  IF v_ids IS NULL THEN RETURN 0; END IF;
  PERFORM public.novedades_android_avisar(v_ids);
  RETURN cardinality(v_ids);
END $$;

REVOKE EXECUTE ON FUNCTION public.novedades_android_agregados(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novedades_android_agregados(uuid[]) TO authenticated, service_role;
