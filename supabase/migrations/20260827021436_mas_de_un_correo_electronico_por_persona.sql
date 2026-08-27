-- Más de un correo, como ya pasaba con el teléfono.
--
-- `extra_phones` existe desde hace rato y el correo se quedó en uno solo sin
-- ninguna razón: una persona tiene el correo personal y el de la empresa, y
-- guardar sólo uno obliga a elegir cuál pierde — normalmente el que no se usó
-- ese día.
--
-- Va como `text[]` y no como jsonb por la misma razón que `extra_phones`: es
-- una lista de valores sin estructura, y un array de texto se filtra y se
-- indexa sin desarmar nada.
--
-- Ojo: NO se llama a `regrant_employees_columns()` acá a propósito. Desde
-- 20260826222114 lo hace solo un event trigger cuando `employees_safe` cambia,
-- dentro de la misma transacción. Ésta es la primera migración que se apoya en
-- eso, y se verificó después de aplicarla: 0 columnas sin permiso.

SET lock_timeout = '5s';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS extra_emails text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.employees.extra_emails IS 'Correos ADEMÁS del principal (`email`), igual que `extra_phones` con el teléfono.';

CREATE OR REPLACE VIEW public.employees_safe
WITH (security_invoker = true) AS
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
    carne_pendiente,
    periodo_pago, herramientas_entregadas,
    contrato_lugar_celebracion, contrato_fecha_celebracion,
    lugar_nacimiento, distrito, emergency_contacts,
    isss_estado, afp_estado,
    medico_license_number, contador_license_number,
    tiene_acreditacion_dependiente,
    tipo_ficha,
    forma_estipulacion_salario, medio_pago, lugar_pago,
    mtps_remitido_fecha, contrato_prorrogas,
    extra_emails
   FROM public.employees;
