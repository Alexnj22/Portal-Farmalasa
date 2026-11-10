-- La identidad de quien consulta se calcula UNA vez por consulta, no 10-20.
--
-- 2026-11-10 (PLAN-MEMORIA-DE-LA-BASE, fase 3). Medido en producción: la
-- consulta de ventas por hora de hoy lee ~500 filas y tarda 57 ms, de los que
-- ~2,900 bloques son las comprobaciones de permiso. Cada policy pregunta
-- `auth_employee_role_id()`, `auth_employee_secondary_role_id()`,
-- `auth_employee_branch_id()`… y cada una vuelve a buscar al empleado, su cuenta
-- ligada y su apoyo vigente (`apoyo_vigente` recorre employee_events). Por
-- llamada: role_id 1.4 ms, secondary 1.3 ms, is_su 1.4 ms,
-- has_module_permission 5.8 ms, module_scope 13.4 ms — y una policy como la de
-- sales_invoices llama a las de módulo tres veces.
--
-- Lo que cambia: `auth_yo()` hace la MISMA búsqueda que hacían las cuatro (copiada
-- tal cual) y guarda el resultado en un ajuste local a la transacción, con la
-- clave «uid @ statement_timestamp()». Se reusa mientras no cambie el usuario ni
-- termine la transacción; las cuatro funciones conservan firma, tipo, permisos y
-- resultado.
--
-- Para que sea EXACTAMENTE lo de antes aunque una función cambie la identidad a
-- mitad de una sentencia (asignar un apoyo y después consultar), cualquier
-- escritura en las cuatro tablas de las que sale la identidad borra el
-- recuerdo: triggers por SENTENCIA (no por fila), que sólo hacen un set_config.
--
-- Confianza: el recuerdo vive en un ajuste de la sesión, igual que
-- `request.jwt.claims`, de donde ya sale `auth.uid()`. Quien pudiera escribir
-- ese ajuste ya podía hacerse pasar por otro usuario; no se abre nada nuevo.
--
-- Verificado: huella de identidad (todos los usuarios) y de permisos por módulo
-- idéntica antes y después, en el entorno de pruebas y en producción.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_yo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_clave text := coalesce(v_uid::text, '-') || '@' || statement_timestamp()::text;
  v_c     text := current_setting('farmalasa.auth_yo', true);
  v_yo    jsonb;
BEGIN
  IF v_c IS NOT NULL AND v_c <> '' THEN
    v_yo := v_c::jsonb;
    IF v_yo->>'k' = v_clave THEN
      RETURN v_yo;
    END IF;
  END IF;

  -- La búsqueda de las cuatro funciones de antes, en una sola pasada.
  SELECT jsonb_build_object(
           'k', v_clave,
           'e', e.id,
           'r', coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id),
           's', CASE WHEN public.cargo_de_apoyo_vigente(e.id) IS NOT NULL THEN NULL
                     ELSE e.secondary_role_id END,
           'b', coalesce(public.sala_de_apoyo_vigente(e.id), e.branch_id))
    INTO v_yo
    FROM public.employees e
   WHERE e.id = v_uid
      OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                  WHERE l.auth_user_id = v_uid)
   ORDER BY (e.id = v_uid) DESC
   LIMIT 1;

  v_yo := coalesce(v_yo, jsonb_build_object('k', v_clave));
  PERFORM set_config('farmalasa.auth_yo', v_yo::text, true);
  RETURN v_yo;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_yo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_yo() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auth_employee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT (public.auth_yo() ->> 'e')::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.auth_employee_role_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT (public.auth_yo() ->> 'r')::integer;
$function$;

CREATE OR REPLACE FUNCTION public.auth_employee_secondary_role_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT (public.auth_yo() ->> 's')::integer;
$function$;

CREATE OR REPLACE FUNCTION public.auth_employee_branch_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT (public.auth_yo() ->> 'b')::integer;
$function$;

-- Olvidar el recuerdo cuando cambia algo de lo que sale la identidad.
CREATE OR REPLACE FUNCTION public.auth_yo_olvidar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, extensions
AS $function$
BEGIN
  PERFORM set_config('farmalasa.auth_yo', '', true);
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_yo_olvidar() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_auth_yo_olvidar ON public.employees;
CREATE TRIGGER trg_auth_yo_olvidar AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON public.employees FOR EACH STATEMENT EXECUTE FUNCTION public.auth_yo_olvidar();
DROP TRIGGER IF EXISTS trg_auth_yo_olvidar ON public.employee_auth_accounts;
CREATE TRIGGER trg_auth_yo_olvidar AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON public.employee_auth_accounts FOR EACH STATEMENT EXECUTE FUNCTION public.auth_yo_olvidar();
DROP TRIGGER IF EXISTS trg_auth_yo_olvidar ON public.employee_events;
CREATE TRIGGER trg_auth_yo_olvidar AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON public.employee_events FOR EACH STATEMENT EXECUTE FUNCTION public.auth_yo_olvidar();
DROP TRIGGER IF EXISTS trg_auth_yo_olvidar ON public.roles;
CREATE TRIGGER trg_auth_yo_olvidar AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON public.roles FOR EACH STATEMENT EXECUTE FUNCTION public.auth_yo_olvidar();
