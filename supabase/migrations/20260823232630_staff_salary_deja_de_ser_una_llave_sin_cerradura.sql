SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- `staff_salary` deja de ser una llave sin cerradura
-- ─────────────────────────────────────────────────────────────────────────────
--
-- El módulo existía en la pantalla de Permisos desde siempre, se podía prender y
-- apagar, y NO GATEABA NADA: `employees_safe` publicaba `base_salary`,
-- `bank_name` y `account_number` a cualquiera que pudiera leer la vista.
-- Levantado por `gate:permisos` el 2026-08-03 como «hallazgo abierto por
-- decisión», y medido de nuevo en la auditoría del 2026-08-23.
--
-- ── Lo que la medición corrigió del propio hallazgo ─────────────────────────
-- El informe decía «el salario viaja al navegador de cualquiera que abra un
-- expediente». Es cierto en la letra y engañoso en el fondo: los CUATRO cargos
-- que hoy pueden abrir un expediente (Administrador, Jefe/a de Talento Humano,
-- QA/Testing y Supervisor/a de Ventas) son EXACTAMENTE los mismos cuatro que
-- tienen la llave del salario. O sea que hoy no se le escapa a nadie.
--
-- Pero esa protección es una COINCIDENCIA DE CONFIGURACIÓN, no una regla. El día
-- que alguien le dé `staff_detail` a una jefatura de sala —que es exactamente lo
-- que la pantalla de Permisos invita a hacer, con `staff_salary` apagado al
-- lado— el salario viaja igual y el interruptor que dice controlarlo no hace
-- nada. Se arregla ahora justamente porque hoy no le quita el dato a nadie: los
-- cuatro que lo verían son los cuatro que ya lo ven.
--
-- ── El patrón ya estaba resuelto en este repo ──────────────────────────────
-- Es el mismo movimiento que se le hizo al código de carné: publicarlo en la
-- vista significaba que cualquier empleado con sesión leía el de todos, así que
-- se sacó de ahí y se puso detrás de `get_employee_credenciales`. Ver un dato
-- sensible pasa a ser una llamada EXPLÍCITA en vez de un efecto de traer la fila.
--
-- ── Por qué DROP y no CREATE OR REPLACE ────────────────────────────────────
-- Postgres no deja QUITAR columnas de una vista con `CREATE OR REPLACE`
-- («cannot drop columns from view»), sólo agregarlas al final. Se comprobó antes
-- que NADA depende de `employees_safe` —ni otra vista ni una función— así que el
-- DROP no arrastra nada, y va dentro de la transacción de la migración: no hay
-- un instante en que el portal la encuentre ausente.
--
-- Los GRANT se reponen idénticos a los que tenía. Recrear una vista los pierde,
-- y perder el de `authenticated` deja el portal entero sin poder leer empleados
-- —incluido el login, que resuelve el usuario contra esta vista—.
--
-- ── Lo que NO se toca, y por qué ───────────────────────────────────────────
-- `dui`, `afp_number` e `isss_number` se quedan. Están en `SENSITIVE_FIELDS` del
-- navegador, pero son identidad previsional y no «salarios e ingresos», que es
-- lo que este módulo dice gatear. Moverlos exige decidir bajo qué llave van, y
-- esa decisión no es de esta migración.
--
-- Probado antes en el branch `staging` (cbnjplmnfmfsambavjce): 83 → 80 columnas,
-- cero de dinero expuestas, `authenticated` conserva el SELECT, `anon` no puede
-- ejecutar la función, y la puerta devuelve CERO filas sin sesión válida.

DROP VIEW public.employees_safe;

CREATE VIEW public.employees_safe
WITH (security_invoker = true) AS
 SELECT id, branch_id, shift_id, photo_url, phone, address, dui, birth_date,
    status, hire_date, afp_number, isss_number, weekly_schedule, exceptions,
    created_at, role_id, secondary_role_id, username, first_names, last_names,
    gender, blood_type, marital_status, emergency_contact_name,
    emergency_contact_phone, contract_type, weekly_contracted_hours,
    department, municipality, education_level, profession, contract_end_date,
    name, system_role, email, hours_owed, afp_institution, account_type,
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
    pharmacist_license_number, has_disability, disability_type,
    disability_grade, disability_has_certification, chronic_conditions,
    blocked_until, blocked_reason, blocked_at, blocked_by, suplente_id,
    carne_pendiente
   FROM employees;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.employees_safe TO authenticated, service_role, postgres;

COMMENT ON VIEW public.employees_safe IS
'La ficha de empleado que puede leer el portal. NO trae los datos de dinero (base_salary, bank_name, account_number): salieron el 2026-08-23 y viven detrás de get_employee_salarios, con la llave staff_salary. Tampoco trae `code` ni `kiosk_pin` — el código de carné ES la contraseña y salió antes, por el mismo motivo.';

-- ── La puerta ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_employee_salarios(p_ids uuid[])
RETURNS TABLE(employee_id uuid, base_salary numeric, bank_name text, account_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_alcance text;
BEGIN
    -- La compuerta va envuelta en `(SELECT …)` — regla del incidente del
    -- 2026-07-08. Acá no es por velocidad (es una sola evaluación) sino por
    -- consistencia: la forma correcta se escribe siempre igual, para que la
    -- excepción no parezca normal en la próxima función.
    IF NOT (SELECT auth_has_module_permission('staff_salary', 'can_view')) THEN
        RETURN;   -- sin la llave no se lanza: se devuelve VACÍO.
    END IF;

    v_alcance := (SELECT auth_module_scope('staff_salary'));

    RETURN QUERY
    SELECT e.id, e.base_salary, e.bank_name, e.account_number
    FROM employees e
    WHERE e.id = ANY(p_ids)
      -- El alcance se respeta aunque hoy los cuatro cargos que tienen la llave
      -- estén en ALL: si mañana se le da a una jefatura de sala con alcance
      -- BRANCH, tiene que ver los suyos y nada más. Escribirlo ahora cuesta una
      -- línea; agregarlo después de que alguien confíe en el módulo, no.
      AND (v_alcance = 'ALL' OR e.branch_id = (SELECT auth_employee_branch_id()));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_employee_salarios(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_employee_salarios(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_employee_salarios(uuid[]) IS
'Los datos de dinero de un empleado (sueldo base, banco, cuenta), detrás del módulo staff_salary. Salieron de employees_safe el 2026-08-23: la vista los publicaba y el módulo no gateaba nada. Sin la llave devuelve VACÍO, no error.';
