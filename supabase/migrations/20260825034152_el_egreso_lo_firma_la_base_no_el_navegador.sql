-- Fase 1.2 de docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md — el registro se
-- escribe por acá y no con un INSERT del cliente.
--
-- El motivo no es comodidad: `export_log.employee_id` tiene que ser la FICHA
-- (`employees.id`), y el navegador conoce la CUENTA (`auth.users.id`). Para 33
-- de las 42 personas que usan el portal esos dos ids NO son el mismo valor —
-- entran por una cuenta `*@staff.local` ligada en `employee_auth_accounts`— así
-- que un INSERT que mandara `session.user.id` sería rechazado por la policy
-- justamente para la mayoría de la gente, y en silencio.
--
-- Y hay una segunda razon, mas importante: quien exporta NO elige a nombre de
-- quien queda anotado. La firma sale de `auth_employee_id()` adentro de la
-- funcion. Es la regla de siempre — la autoria nunca viaja como parametro.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.registrar_egreso(
  p_modulo  text,
  p_formato text    DEFAULT NULL,
  p_filas   integer DEFAULT NULL,
  p_detalle jsonb   DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_yo uuid; v_id uuid;
BEGIN
  v_yo := (SELECT public.auth_employee_id());
  IF v_yo IS NULL THEN
    RAISE EXCEPTION 'no hay sesion que firme el egreso' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_modulo), '') = '' THEN
    RAISE EXCEPTION 'un egreso sin modulo no se puede leer despues' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.export_log (employee_id, modulo, formato, filas, detalle)
  VALUES (v_yo, btrim(p_modulo), nullif(btrim(coalesce(p_formato,'')),''),
          p_filas, coalesce(p_detalle, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.registrar_egreso(text,text,integer,jsonb) IS
  'Anota una salida de datos del portal. La firma sale de auth_employee_id() adentro: quien exporta no elige a nombre de quien queda anotado.';

REVOKE EXECUTE ON FUNCTION public.registrar_egreso(text,text,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_egreso(text,text,integer,jsonb) TO authenticated, service_role;
