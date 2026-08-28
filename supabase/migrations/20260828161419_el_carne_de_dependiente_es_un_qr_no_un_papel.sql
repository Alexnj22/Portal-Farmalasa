SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El carné de dependiente de farmacia dejó de ser un papel: es un QR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El CSSP lo digitalizó. Ya no se entrega una tarjeta que se fotografía y se
-- adjunta: se entrega un QR que lleva a la ficha en línea, del estilo
-- https://expedientes.srs.gob.sv/carnets/dependientes/1758306680151
--
-- Guardar una FOTO de ese QR sería guardar la imagen de un puntero: la ficha
-- de verdad vive en el sitio del Consejo y se actualiza sola cuando la persona
-- reacredita. Lo que hay que conservar es la DIRECCIÓN, no su dibujo — con la
-- dirección el portal puede volver a pintar el QR cuando haga falta, y además
-- se puede abrir para comprobar que la acreditación sigue vigente.
--
-- ── Por qué la restricción es del DOMINIO y no de la ruta ──────────────────
--
-- Sin ninguna guarda, este campo acepta cualquier enlace y el expediente
-- termina con un puntero a cualquier cosa. Con la ruta exacta
-- (`/carnets/dependientes/…`), el día que el Consejo reacomode su sitio el
-- portal deja de aceptar carnés válidos y nadie va a saber por qué.
--
-- El dominio es el punto medio: `srs.gob.sv` por https es lo que hace que el
-- dato signifique algo —viene del Consejo Superior de Salud Pública— y
-- sobrevive a que cambien el camino o agreguen un subdominio.
--
-- Medido contra las cuatro formas que tiene que distinguir: acepta el carné
-- real, y rechaza otro dominio, el mismo por http, y el truco del sufijo
-- (`srs.gob.sv.otracosa.com`).
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS carne_dependiente_url text;

ALTER TABLE public.employees
    DROP CONSTRAINT IF EXISTS employees_carne_dependiente_url_del_cssp;

ALTER TABLE public.employees
    ADD CONSTRAINT employees_carne_dependiente_url_del_cssp
    CHECK (
        carne_dependiente_url IS NULL
        OR carne_dependiente_url ~* '^https://([a-z0-9-]+\.)*srs\.gob\.sv/.'
    );

COMMENT ON COLUMN public.employees.carne_dependiente_url IS
    'La dirección del carné digital de dependiente de farmacia del CSSP, leída de su QR. '
    'Se guarda la dirección y no una foto: la ficha vive en el sitio del Consejo y se '
    'actualiza sola al reacreditar.';

-- ── La vista tiene que enumerarla, o el portal no la lee ───────────────────
--
-- `employees_safe` lista sus columnas una por una y el portal la consulta con
-- `select('*')`, así que una columna que no esté acá no existe para el
-- formulario — se guardaría y volvería vacía en la siguiente carga, sin ningún
-- error. La columna va AL FINAL porque `CREATE OR REPLACE VIEW` no admite
-- reordenar ni insertar en el medio.
--
-- Los permisos de esta vista son de TABLA, no por columna (verificado: las 96
-- columnas tienen el mismo grant para cada rol), así que la nueva queda cubierta
-- sola. Con permisos por columna habría que otorgarlo a mano, y olvidarlo rompe
-- la vista ENTERA — ver [[feedback_con_permiso_por_columna_una_columna_nueva_nace_sin_permiso]].
CREATE OR REPLACE VIEW public.employees_safe
WITH (security_invoker = true) AS
 SELECT id, branch_id, shift_id, photo_url, phone, address, birth_date, status,
    hire_date, weekly_schedule, exceptions, created_at, role_id, secondary_role_id,
    username, first_names, last_names, gender, blood_type, marital_status,
    emergency_contact_name, emergency_contact_phone, contract_type,
    weekly_contracted_hours, department, municipality, education_level, profession,
    contract_end_date, name, system_role, email, hours_owed, afp_institution,
    account_type, education_grade_completed, education_specialty, is_studying,
    study_start_date, study_duration_years, extra_phones, extra_addresses,
    additional_skills, has_maestria, maestria_title, maestria_is_studying,
    maestria_study_start_date, maestria_study_duration_years, economic_dependents,
    emergency_contact_relationship, emergency_contact_extra_phones,
    contract_start_date, has_motorcycle, has_car, has_motorcycle_license,
    has_car_license, has_srs_accreditation, srs_accreditation_expiry, nationality,
    contract_temporal_legal_basis, contract_temporal_reason, employee_documents,
    alt_identity_document_type, nursing_license_number, pharmacist_license_number,
    has_disability, disability_type, disability_grade, disability_has_certification,
    chronic_conditions, blocked_until, blocked_reason, blocked_at, blocked_by,
    suplente_id, carne_pendiente, periodo_pago, herramientas_entregadas,
    contrato_lugar_celebracion, contrato_fecha_celebracion, lugar_nacimiento,
    distrito, emergency_contacts, isss_estado, afp_estado, medico_license_number,
    contador_license_number, tiene_acreditacion_dependiente, tipo_ficha,
    forma_estipulacion_salario, medio_pago, lugar_pago, mtps_remitido_fecha,
    contrato_prorrogas, extra_emails, acreditaciones,
    carne_dependiente_url
   FROM employees;
