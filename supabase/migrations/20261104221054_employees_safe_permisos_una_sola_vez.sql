-- employees_safe: los permisos se evalúan UNA vez por consulta, no por campo
-- y por fila (2026-11-04).
--
-- El CTE `ctx` (tres auth_has_module_permission + auth_employee_id) no tiene
-- FROM, así que Postgres lo aplanaba y copiaba la expresión en cada uno de los
-- ~70 CASE de la vista: por cada empleado, ~200 llamadas que leen employees y
-- role_permissions. Lo mismo `rango_de_empleado(e.id)`, 4 veces por fila.
-- Es la lectura de personal que hace el portal al arrancar, en todas las
-- pantallas: pg_stat_statements la daba en 4.8 s de promedio, 12.7 s de
-- máximo y ~974 MB por llamada (703 llamadas), ocupando el pool.
--
-- Medido en transacción revertida, mismas 51 filas y md5 IDÉNTICO:
--   administrador      1,470 ms → 11 ms
--   cuenta de sala    29,579 ms → 15 ms
--   cuenta de sala    29,399 ms → 16 ms
--
-- Parte de la definición VIVA (pg_get_viewdef del 2026-11-04). Cambios:
-- `ctx AS MATERIALIZED` y el rango por un LATERAL con OFFSET 0 (cerca para
-- que no se vuelva a aplanar). Columnas, orden y tipos sin cambio.

SET lock_timeout = '5s';

CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker = true) AS
WITH ctx AS MATERIALIZED (
         SELECT auth_has_module_permission('staff_list'::text, 'can_view'::text) OR auth_has_module_permission('staff_detail'::text, 'can_view'::text) OR auth_has_module_permission('datos_personales'::text, 'can_view'::text) AS ver_personal,
            auth_employee_id() AS mi_id
        )
 SELECT e.id,
    e.branch_id,
    e.shift_id,
    e.photo_url,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.phone
            ELSE NULL::text
        END AS phone,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.address
            ELSE NULL::text
        END AS address,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.birth_date
            ELSE NULL::date
        END AS birth_date,
    e.status,
    e.hire_date,
    e.weekly_schedule,
    e.exceptions,
    e.created_at,
    e.role_id,
    e.secondary_role_id,
    e.username,
    e.first_names,
    e.last_names,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.gender
            ELSE NULL::text
        END AS gender,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.blood_type
            ELSE NULL::text
        END AS blood_type,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.marital_status
            ELSE NULL::text
        END AS marital_status,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.emergency_contact_name
            ELSE NULL::text
        END AS emergency_contact_name,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.emergency_contact_phone
            ELSE NULL::text
        END AS emergency_contact_phone,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contract_type
            ELSE NULL::text
        END AS contract_type,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.weekly_contracted_hours
            ELSE NULL::integer
        END AS weekly_contracted_hours,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.department
            ELSE NULL::text
        END AS department,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.municipality
            ELSE NULL::text
        END AS municipality,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.education_level
            ELSE NULL::text
        END AS education_level,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.profession
            ELSE NULL::text
        END AS profession,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contract_end_date
            ELSE NULL::date
        END AS contract_end_date,
    e.name,
        CASE
            WHEN rg.rango >= 4 THEN 'ADMIN'::text
            WHEN rg.rango = 3 THEN 'SUPERVISOR'::text
            WHEN rg.rango >= 1 THEN 'JEFE'::text
            ELSE 'EMPLEADO'::text
        END AS system_role,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.email
            ELSE NULL::text
        END AS email,
    e.hours_owed,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.afp_institution
            ELSE NULL::text
        END AS afp_institution,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.account_type
            ELSE NULL::text
        END AS account_type,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.education_grade_completed
            ELSE NULL::text
        END AS education_grade_completed,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.education_specialty
            ELSE NULL::text
        END AS education_specialty,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.is_studying
            ELSE NULL::boolean
        END AS is_studying,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.study_start_date
            ELSE NULL::date
        END AS study_start_date,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.study_duration_years
            ELSE NULL::numeric
        END::numeric(3,1) AS study_duration_years,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.extra_phones
            ELSE NULL::text[]
        END AS extra_phones,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.extra_addresses
            ELSE NULL::jsonb
        END AS extra_addresses,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.additional_skills
            ELSE NULL::jsonb
        END AS additional_skills,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_maestria
            ELSE NULL::boolean
        END AS has_maestria,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.maestria_title
            ELSE NULL::text
        END AS maestria_title,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.maestria_is_studying
            ELSE NULL::boolean
        END AS maestria_is_studying,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.maestria_study_start_date
            ELSE NULL::date
        END AS maestria_study_start_date,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.maestria_study_duration_years
            ELSE NULL::numeric
        END AS maestria_study_duration_years,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.economic_dependents
            ELSE NULL::jsonb
        END AS economic_dependents,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.emergency_contact_relationship
            ELSE NULL::text
        END AS emergency_contact_relationship,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.emergency_contact_extra_phones
            ELSE NULL::text[]
        END AS emergency_contact_extra_phones,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contract_start_date
            ELSE NULL::date
        END AS contract_start_date,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_motorcycle
            ELSE NULL::boolean
        END AS has_motorcycle,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_car
            ELSE NULL::boolean
        END AS has_car,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_motorcycle_license
            ELSE NULL::boolean
        END AS has_motorcycle_license,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_car_license
            ELSE NULL::boolean
        END AS has_car_license,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_srs_accreditation
            ELSE NULL::boolean
        END AS has_srs_accreditation,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.srs_accreditation_expiry
            ELSE NULL::date
        END AS srs_accreditation_expiry,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.nationality
            ELSE NULL::text
        END AS nationality,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contract_temporal_legal_basis
            ELSE NULL::text
        END AS contract_temporal_legal_basis,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contract_temporal_reason
            ELSE NULL::text
        END AS contract_temporal_reason,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.employee_documents
            ELSE NULL::jsonb
        END AS employee_documents,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.alt_identity_document_type
            ELSE NULL::text
        END AS alt_identity_document_type,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.nursing_license_number
            ELSE NULL::text
        END AS nursing_license_number,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.pharmacist_license_number
            ELSE NULL::text
        END AS pharmacist_license_number,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.has_disability
            ELSE NULL::boolean
        END AS has_disability,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.disability_type
            ELSE NULL::text
        END AS disability_type,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.disability_grade
            ELSE NULL::text
        END AS disability_grade,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.disability_has_certification
            ELSE NULL::boolean
        END AS disability_has_certification,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.chronic_conditions
            ELSE NULL::jsonb
        END AS chronic_conditions,
    e.blocked_until,
    e.blocked_reason,
    e.blocked_at,
    e.blocked_by,
    e.suplente_id,
    e.carne_pendiente,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.periodo_pago
            ELSE NULL::text
        END AS periodo_pago,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.herramientas_entregadas
            ELSE NULL::jsonb
        END AS herramientas_entregadas,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contrato_lugar_celebracion
            ELSE NULL::text
        END AS contrato_lugar_celebracion,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contrato_fecha_celebracion
            ELSE NULL::date
        END AS contrato_fecha_celebracion,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.lugar_nacimiento
            ELSE NULL::text
        END AS lugar_nacimiento,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.distrito
            ELSE NULL::text
        END AS distrito,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.emergency_contacts
            ELSE NULL::jsonb
        END AS emergency_contacts,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.isss_estado
            ELSE NULL::text
        END AS isss_estado,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.afp_estado
            ELSE NULL::text
        END AS afp_estado,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.medico_license_number
            ELSE NULL::text
        END AS medico_license_number,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contador_license_number
            ELSE NULL::text
        END AS contador_license_number,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.tiene_acreditacion_dependiente
            ELSE NULL::boolean
        END AS tiene_acreditacion_dependiente,
    e.tipo_ficha,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.forma_estipulacion_salario
            ELSE NULL::text
        END AS forma_estipulacion_salario,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.medio_pago
            ELSE NULL::text
        END AS medio_pago,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.lugar_pago
            ELSE NULL::text
        END AS lugar_pago,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.mtps_remitido_fecha
            ELSE NULL::date
        END AS mtps_remitido_fecha,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.contrato_prorrogas
            ELSE NULL::jsonb
        END AS contrato_prorrogas,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.extra_emails
            ELSE NULL::text[]
        END AS extra_emails,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.acreditaciones
            ELSE NULL::jsonb
        END AS acreditaciones,
        CASE
            WHEN c.ver_personal OR e.id = c.mi_id THEN e.carne_dependiente_url
            ELSE NULL::text
        END AS carne_dependiente_url,
    rg.rango AS rango,
    e.nombre_preferido,
    e.apellido_preferido,
    e.nombre_elegido_el,
    e.nombre_corto
   FROM employees e
     CROSS JOIN ctx c
     CROSS JOIN LATERAL ( SELECT rango_de_empleado(e.id) AS rango OFFSET 0) rg;
