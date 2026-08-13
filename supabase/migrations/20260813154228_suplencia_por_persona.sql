-- Suplencia por persona: «si no estoy, me cubre esta persona».
--
-- La delegación por ausencia se construyó sobre el ORGANIGRAMA: hereda quien
-- tenga el cargo padre. Eso no deja elegir a quién te cubre, y un cargo
-- compartido casi nunca queda vacío (basta que un colega esté presente para que
-- nadie herede). Acá se agrega la regla que faltaba, por PERSONA, y las dos
-- conviven: el organigrama queda como respaldo automático debajo
-- (decisión del usuario, 2026-08-13: «el jefe hereda igual»).

SET lock_timeout = '5s';

-- ── 0. Freno: hay otras sesiones trabajando en este mismo esquema ───────────
DO $guard$
DECLARE
  esperado jsonb := jsonb_build_object(
    'hereda_por_ausencia_rol',  '36f6a53175050f082eb10d3a31a24ece',
    'auth_hereda_por_ausencia', '115f64a6f5337396e9a21f3d311275d1',
    'puede_aprobar_modulo',     'be1a14698d4f7a011605a3979741404e',
    'mis_permisos_heredados',   '9b41811aa046a7ccdcf71937affd6734'
  );
  fn text;
  actual text;
BEGIN
  FOR fn IN SELECT jsonb_object_keys(esperado) LOOP
    SELECT md5(string_agg(pg_get_functiondef(p.oid), E'\n' ORDER BY p.oid))
      INTO actual
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;
    IF actual IS DISTINCT FROM (esperado->>fn) THEN
      RAISE EXCEPTION
        'public.% cambió desde que se redactó esta migración (huella % ≠ esperada %). Releer el catálogo antes de reemplazarla.',
        fn, coalesce(actual, '(no existe)'), esperado->>fn;
    END IF;
  END LOOP;
END
$guard$;

-- ── 1. La columna ──────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS suplente_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_suplente_id_fkey') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_suplente_id_fkey
      FOREIGN KEY (suplente_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_suplente_no_es_uno_mismo') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_suplente_no_es_uno_mismo
      CHECK (suplente_id IS NULL OR suplente_id <> id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS employees_suplente_id_idx
  ON public.employees(suplente_id);

COMMENT ON COLUMN public.employees.suplente_id IS
  'Quién cubre a esta persona mientras no está disponible (vacaciones/incapacidad). Le gana al organigrama, que sigue funcionando como respaldo. NULL = sin suplente nombrado.';

-- ── 2. La regla, ahora por empleado ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hereda_por_ausencia_emp(
  p_employee_id uuid, p_module_key text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_employee_id IS NOT NULL AND (
    -- (a) Suplencia nombrada: alguien que no está me eligió para cubrirlo.
    EXISTS (
      SELECT 1
      FROM public.employees titular
      JOIN public.role_permissions rp
        ON rp.role_id IN (titular.role_id, titular.secondary_role_id)
       AND rp.module_key = p_module_key
      WHERE titular.suplente_id = p_employee_id
        AND titular.id <> p_employee_id
        AND titular.status = 'ACTIVO'
        AND rp.delega_en_ausencia
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
        AND public.empleado_no_disponible(titular.id)
    )
    -- (b) Respaldo por organigrama: el cargo hijo quedó sin nadie disponible.
    OR public.hereda_por_ausencia_rol(
         (SELECT e.role_id::bigint FROM public.employees e
           WHERE e.id = p_employee_id AND e.status = 'ACTIVO'),
         p_module_key, p_action)
  );
$function$;

COMMENT ON FUNCTION public.hereda_por_ausencia_emp(uuid, text, text) IS
  'Si este empleado hereda un permiso porque alguien no está: primero por suplencia nombrada (employees.suplente_id), y además por organigrama (hereda_por_ausencia_rol) como respaldo.';

REVOKE ALL ON FUNCTION public.hereda_por_ausencia_emp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hereda_por_ausencia_emp(uuid, text, text) TO authenticated, service_role;

-- ── 3. Los tres llamadores pasan a usarla ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_hereda_por_ausencia(p_module_key text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.hereda_por_ausencia_emp(
           (SELECT public.auth_employee_id()), p_module_key, p_action);
$function$;

CREATE OR REPLACE FUNCTION public.puede_aprobar_modulo(p_employee_id uuid, p_module_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_module_key IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.status = 'ACTIVO'
      AND (
        EXISTS (SELECT 1 FROM public.role_permissions rp
                 WHERE rp.role_id = e.role_id
                   AND rp.module_key = p_module_key AND rp.can_approve)
        OR EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = e.secondary_role_id
                      AND rp.module_key = p_module_key AND rp.can_approve)
        OR public.hereda_por_ausencia_emp(e.id, p_module_key, 'can_approve')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.mis_permisos_heredados()
 RETURNS TABLE(module_key text, can_view boolean, can_edit boolean, can_approve boolean, scope text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH yo AS (
    SELECT (SELECT public.auth_employee_id())      AS id,
           (SELECT public.auth_employee_role_id()) AS role_id
  ), fuentes AS (
    SELECT rp.module_key, rp.can_view, rp.can_edit, rp.can_approve, rp.scope
      FROM public.employees titular
      JOIN public.role_permissions rp
        ON rp.role_id IN (titular.role_id, titular.secondary_role_id)
     WHERE titular.suplente_id = (SELECT id FROM yo)
       AND titular.id <> (SELECT id FROM yo)
       AND titular.status = 'ACTIVO'
       AND rp.delega_en_ausencia
       AND public.empleado_no_disponible(titular.id)
    UNION ALL
    SELECT rp.module_key, rp.can_view, rp.can_edit, rp.can_approve, rp.scope
      FROM public.roles hijo
      JOIN public.role_permissions rp ON rp.role_id = hijo.id
     WHERE rp.delega_en_ausencia
       AND hijo.parent_role_id = (SELECT role_id FROM yo)
       AND EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.role_id = hijo.id AND e.status = 'ACTIVO')
       AND NOT EXISTS (SELECT 1 FROM public.employees e
                        WHERE e.role_id = hijo.id AND e.status = 'ACTIVO'
                          AND NOT public.empleado_no_disponible(e.id))
  )
  SELECT f.module_key,
         bool_or(f.can_view)    AS can_view,
         bool_or(f.can_edit)    AS can_edit,
         bool_or(f.can_approve) AS can_approve,
         CASE WHEN bool_or(f.scope = 'ALL')    THEN 'ALL'
              WHEN bool_or(f.scope = 'BRANCH') THEN 'BRANCH'
              ELSE 'MINE' END   AS scope
    FROM fuentes f
   WHERE f.can_view OR f.can_edit OR f.can_approve
   GROUP BY f.module_key;
$function$;

-- ── 4. Quién cubre a quién, para poder nombrarlo en pantalla ───────────────
CREATE OR REPLACE FUNCTION public.quien_cubre_al_empleado(p_employee_id uuid)
 RETURNS TABLE(employee_id uuid, employee_name text, via text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT s.id, s.name, 'SUPLENTE'::text
    FROM public.employees yo
    JOIN public.employees s ON s.id = yo.suplente_id AND s.status = 'ACTIVO'
   WHERE yo.id = p_employee_id
  UNION ALL
  SELECT j.id, j.name, 'ORGANIGRAMA'::text
    FROM public.employees yo
    JOIN public.roles mi_cargo ON mi_cargo.id = yo.role_id
    JOIN public.employees j ON j.role_id = mi_cargo.parent_role_id AND j.status = 'ACTIVO'
   WHERE yo.id = p_employee_id;
$function$;

COMMENT ON FUNCTION public.quien_cubre_al_empleado(uuid) IS
  'Quién se hace cargo de lo de esta persona mientras no está: el suplente nombrado y/o el cargo padre.';

REVOKE ALL ON FUNCTION public.quien_cubre_al_empleado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quien_cubre_al_empleado(uuid) TO authenticated, service_role;

-- ── 5. Paridad de columnas: el portal lee employees_safe, no employees ─────
CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker = true) AS
 SELECT id, code, branch_id, shift_id, photo_url, phone, address, dui, birth_date,
        status, hire_date, afp_number, isss_number, bank_name, account_number,
        weekly_schedule, exceptions, created_at, role_id, secondary_role_id,
        kiosk_pin, username, first_names, last_names, gender, blood_type,
        marital_status, emergency_contact_name, emergency_contact_phone,
        contract_type, weekly_contracted_hours, base_salary, department,
        municipality, education_level, profession, contract_end_date, name,
        system_role, email, hours_owed, afp_institution, account_type,
        education_grade_completed, education_specialty, is_studying,
        study_start_date, study_duration_years, extra_phones, extra_addresses,
        additional_skills, has_maestria, maestria_title, maestria_is_studying,
        maestria_study_start_date, maestria_study_duration_years,
        economic_dependents, emergency_contact_relationship,
        emergency_contact_extra_phones, contract_start_date, has_motorcycle,
        has_car, has_motorcycle_license, has_car_license, has_srs_accreditation,
        srs_accreditation_expiry, nationality, alt_identity_document,
        contract_temporal_legal_basis, contract_temporal_reason,
        employee_documents, alt_identity_document_type, nursing_license_number,
        pharmacist_license_number, chronic_conditions, has_disability,
        disability_type, disability_grade, disability_has_certification,
        suplente_id
   FROM employees;
