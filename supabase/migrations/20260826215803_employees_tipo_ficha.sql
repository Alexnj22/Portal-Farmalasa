-- Qué ES una ficha de `employees`, dicho por el dato y no por un filtro de una vista.
--
-- Hasta hoy la tabla no distinguía a una PERSONA EN PLANILLA de una cuenta
-- técnica ni de un servicio externo, y lo único que escondía a la cuenta de
-- superusuario era un `.filter()` dentro de `StaffManagementView`. O sea que
-- protegía UNA pantalla: verificado, `SchedulesView` y `VacationPlanView` leen
-- `employees` en crudo, así que el Plan Anual de Vacaciones —documento con peso
-- legal, Art. 177 CT— incluía a «QA Testing» y al «Contador Externo» como
-- personal con derecho a vacaciones. El conteo de la pantalla decía 47 y el
-- `Directorio_Personal.csv` los bajaba también.
--
-- Y las cuatro estaban `ACTIVO` con `contract_type = 'INDEFINIDO'`, que es
-- justamente la afirmación que hace daño: el registro decía que una cuenta de
-- pruebas era personal permanente de Salud 1, y que un contador externo tenía
-- contrato indefinido — la segunda es la simulación laboral al revés, y en una
-- inspección argumenta EN CONTRA de la empresa.
--
-- El default es 'empleado' a propósito, y no es simetría: una ficha mal marcada
-- como técnica DESAPARECE de la planilla de una persona real, que es el error
-- caro. Al revés, una cuenta técnica de más en la lista se ve y se corrige.
SET lock_timeout = '5s';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS tipo_ficha text NOT NULL DEFAULT 'empleado';

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_tipo_ficha_check;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_tipo_ficha_check
  CHECK (tipo_ficha IN ('empleado', 'servicio_externo', 'tecnica'));

COMMENT ON COLUMN public.employees.tipo_ficha IS
  'Qué es esta ficha: empleado = persona en planilla (el único que cuenta para '
  'nómina, vacaciones, horarios, conteo de cabezas y el directorio); '
  'servicio_externo = presta un servicio y necesita entrar al portal, pero no '
  'es personal contratado; tecnica = cuenta del sistema, no es una persona. '
  'El default es empleado: marcar de menos deja a alguien fuera de la planilla, '
  'que es peor que marcar de más.';

-- `contract_type` se pone en NULL en las que no son empleados: una ficha que no
-- es una persona contratada no puede declarar un tipo de contrato. La columna
-- es nullable (su default 'INDEFINIDO' sólo aplica al insertar).
UPDATE public.employees
   SET tipo_ficha = 'tecnica', contract_type = NULL
 WHERE code IN ('99999', '71015');

UPDATE public.employees
   SET tipo_ficha = 'servicio_externo', contract_type = NULL
 WHERE code = '77777';

-- `employees_safe` enumera sus columnas, así que una columna nueva no llega
-- sola. Sin esto el frontend leería `tipo_ficha` como `undefined` en las 49
-- fichas y el filtro nuevo no filtraría nada — sin dar error.
CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker = true) AS
 SELECT id, branch_id, shift_id, photo_url, phone, address, birth_date, status,
    hire_date, weekly_schedule, exceptions, created_at, role_id,
    secondary_role_id, username, first_names, last_names, gender, blood_type,
    marital_status, emergency_contact_name, emergency_contact_phone,
    contract_type, weekly_contracted_hours, department, municipality,
    education_level, profession, contract_end_date, name, system_role, email,
    hours_owed, afp_institution, account_type, education_grade_completed,
    education_specialty, is_studying, study_start_date, study_duration_years,
    extra_phones, extra_addresses, additional_skills, has_maestria,
    maestria_title, maestria_is_studying, maestria_study_start_date,
    maestria_study_duration_years, economic_dependents,
    emergency_contact_relationship, emergency_contact_extra_phones,
    contract_start_date, has_motorcycle, has_car, has_motorcycle_license,
    has_car_license, has_srs_accreditation, srs_accreditation_expiry,
    nationality, contract_temporal_legal_basis, contract_temporal_reason,
    employee_documents, alt_identity_document_type, nursing_license_number,
    pharmacist_license_number, has_disability, disability_type,
    disability_grade, disability_has_certification, chronic_conditions,
    blocked_until, blocked_reason, blocked_at, blocked_by, suplente_id,
    carne_pendiente, periodo_pago, herramientas_entregadas,
    contrato_lugar_celebracion, contrato_fecha_celebracion, lugar_nacimiento,
    distrito, emergency_contacts, isss_estado, afp_estado,
    medico_license_number, contador_license_number,
    tiene_acreditacion_dependiente,
    tipo_ficha
   FROM public.employees;
