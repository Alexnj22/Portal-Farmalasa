-- El contrato: cómo se paga, dónde, y qué se remitió al Ministerio.
--
-- ── 11 · «Forma, período y lugar de pago» son TRES campos, no uno ───────────
--
-- El Art. 23 nº9 los nombra juntos y es fácil leerlos como uno solo. No lo son:
--
--   · `forma_estipulacion_salario` — Art. 126: por unidad de tiempo, por unidad
--     de obra, sistema mixto, por tarea o por comisión. Catálogo CERRADO, y es
--     el que decide **cuándo el pago se vuelve exigible** (Art. 130): por
--     unidad de tiempo, al vencer el período; por obra o tarea, dentro de los
--     dos días de la entrega; por comisión, al liquidar y al menos cada quince
--     días. No es una etiqueta: es la regla del plazo.
--
--   · `medio_pago` — lo que Talento Humano llamó «forma». La ley NO enumera
--     «efectivo o transferencia»: dice **moneda de curso legal** (Art. 120) y
--     **prohíbe** fichas, vales, pagarés y cupones (Art. 30 nº9). Por eso el
--     catálogo tiene dos entradas y ninguna es un vale: lo que la ley prohíbe
--     no se ofrece en un desplegable.
--
--   · `lugar_pago` — Art. 128: el convenido, o el del reglamento interno; a
--     falta de estipulación, el acostumbrado o donde presta servicios. Y el
--     Art. 129, que prohíbe pagar en tiendas de venta al por menor, **no les
--     aplica**: su propio inciso exceptúa a los trabajadores de esos
--     establecimientos. Pagar en la sala es válido, y queda escrito acá para
--     que nadie lo «corrija» dentro de seis meses.
--
-- El período ya existe (`periodo_pago`).
--
-- ── 9 · El acuse del Ministerio de Trabajo ─────────────────────────────────
--
-- Art. 18: TRES ejemplares, y el tercero a la Dirección General de Trabajo
-- **dentro de los 8 días** siguientes a la celebración, modificación o
-- prórroga. El mismo artículo dice que **omitirlo no afecta la validez del
-- contrato**, así que esto existe para AVISAR y no para bloquear: un candado
-- sobre algo que la ley no anula produce el atajo, no el cumplimiento.
--
-- No aplica a servicios profesionales: el Art. 18 es para contratos DE TRABAJO
-- y un contrato de servicios profesionales es civil.
--
-- ── 8 · Las prórrogas se acumulan, no se pisan ─────────────────────────────
--
-- Lista y no un par de columnas porque cada prórroga **vuelve a disparar los 8
-- días del Art. 18**, y porque en una disputa importa la cadena completa: un
-- contrato prorrogado cinco veces sobre una labor permanente es exactamente lo
-- que el Art. 25 presume indefinido. Guardar sólo la última borraría la única
-- evidencia de eso.

SET lock_timeout = '5s';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS forma_estipulacion_salario text,
  ADD COLUMN IF NOT EXISTS medio_pago                 text,
  ADD COLUMN IF NOT EXISTS lugar_pago                 text,
  ADD COLUMN IF NOT EXISTS mtps_remitido_fecha        date,
  ADD COLUMN IF NOT EXISTS contrato_prorrogas         jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Sin default, como los del Art. 23: NULL es «no se pactó» y se ve; un default
-- se confunde con un dato (`contract_type` y las 44 horas ya lo enseñaron).
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_forma_estipulacion_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_forma_estipulacion_check
  CHECK (forma_estipulacion_salario IS NULL OR forma_estipulacion_salario IN
         ('TIEMPO','OBRA','MIXTO','TAREA','COMISION'));

-- Dos valores, y ninguno es un vale: el Art. 30 nº9 los prohíbe, así que no se
-- ofrecen. Un catálogo que incluye lo prohibido invita a elegirlo.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_medio_pago_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_medio_pago_check
  CHECK (medio_pago IS NULL OR medio_pago IN ('EFECTIVO','TRANSFERENCIA'));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_prorrogas_es_lista;
ALTER TABLE public.employees ADD CONSTRAINT employees_prorrogas_es_lista
  CHECK (jsonb_typeof(contrato_prorrogas) = 'array');

COMMENT ON COLUMN public.employees.forma_estipulacion_salario IS 'Art. 126 CT. Decide cuándo el pago se vuelve exigible (Art. 130): no es una etiqueta.';
COMMENT ON COLUMN public.employees.medio_pago IS 'EFECTIVO | TRANSFERENCIA. La ley pide moneda de curso legal (Art. 120) y prohíbe vales y fichas (Art. 30 nº9): por eso no hay una tercera opción.';
COMMENT ON COLUMN public.employees.lugar_pago IS 'Art. 128 CT. Pagar en la sala es válido: el Art. 129 exceptúa a los trabajadores del propio establecimiento.';
COMMENT ON COLUMN public.employees.mtps_remitido_fecha IS 'Art. 18 CT: 8 días desde celebración, modificación o prórroga. Omitirlo NO invalida el contrato, así que el portal avisa y no bloquea. No aplica a servicios profesionales.';
COMMENT ON COLUMN public.employees.contrato_prorrogas IS '[{desde, hasta, motivo, remitido_mtps}]. Lista y no columnas: cada prórroga vuelve a disparar los 8 días del Art. 18, y la cadena completa es la evidencia de un plazo encadenado sobre labor permanente (Art. 25).';

-- ⚠️ Esta lista se copió del catálogo EN VIVO, no de un borrador.
-- El primer intento de esta migración usó una copia de hacía media hora y
-- Postgres la rechazó: otra sesión había agregado `tipo_ficha` en el medio, y
-- un `CREATE OR REPLACE VIEW` con la lista vieja se la habría llevado puesta.
-- Con dos sesiones tocando esta vista, releer antes de escribir no es
-- prolijidad: es lo único que evita borrarle una columna a otro.
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
    mtps_remitido_fecha, contrato_prorrogas
   FROM public.employees;

-- ⚠️ ESTA LÍNEA NO ES OPCIONAL, Y OLVIDARLA YA TUMBÓ EL PORTAL HOY.
--
-- `employees_safe` es `security_invoker = true` y `authenticated` tiene SELECT
-- **por columna** sobre `employees`. Una columna nueva en la vista sin su GRANT
-- hace fallar TODA lectura de la vista con 403 —no sólo la de esa columna— y el
-- padrón no carga. Toda migración que toque esta vista termina acá.
SELECT public.regrant_employees_columns();
