-- El expediente después de la revisión con Talento Humano (2026-08-26).
--
-- Cuatro grupos de columnas, cada uno con su motivo:
--
-- 1 · LO QUE TRAE EL DUI. El reverso del DUI lleva domicilio, profesión u
--     oficio, estado familiar y tipo de sangre; el anverso, sexo, lugar y fecha
--     de nacimiento y lugar y fecha de expedición. De todo eso sólo faltaban
--     dónde guardar la FECHA DE VENCIMIENTO del documento y el LUGAR DE
--     NACIMIENTO — el resto ya tenía su campo.
--
--     Que el DUI venza importa: es el documento con el que la persona se
--     identifica ante el ISSS, la AFP y Hacienda, y vencido no sirve. Con la
--     fecha acá, entra al mismo aviso diario que ya vigila las acreditaciones.
--
-- 3 · ACREDITACIONES E IDENTIDAD PREVISIONAL. Las tres juntas de salud
--     dependen del Consejo Superior de Salud Pública —médica, enfermería y
--     químico farmacéutica—; contaduría NO: es el Consejo de Vigilancia de la
--     Profesión de Contaduría Pública y Auditoría, otro organismo. Por eso son
--     columnas separadas y no un «número de junta» genérico.
--
--     `isss_estado` y `afp_estado` no son booleanos y NULL no es «no tiene»:
--     NULL es «nadie preguntó». La diferencia es la que decide si el portal
--     orienta a alguien o no, y un booleano la borra. Y los dos trámites no son
--     iguales: al ISSS lo inscribe el PATRONO, la AFP la elige el TRABAJADOR y
--     sólo él puede afiliarse — así que «pendiente» significa cosas distintas y
--     el aviso va a destinatarios distintos.
--
-- 4 · DISTRITO. Desde la reestructuración municipal el país tiene 14
--     departamentos, 44 municipios y 262 distritos. La ficha fiscal del cliente
--     ya los pide y `EL_SALVADOR_DISTRITOS` ya los tiene: acá sólo faltaba la
--     columna.
--
-- 5 · CONTACTOS DE EMERGENCIA, EN PLURAL. Hoy se puede guardar varios
--     TELÉFONOS de UNA persona, que no es lo mismo que varias personas. Las
--     columnas viejas se quedan: son las que lee el resto del portal, y la
--     primera entrada del array las espeja. Migrar a ciegas los llamadores
--     sería cambiar dos cosas a la vez.

SET lock_timeout = '5s';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS dui_fecha_vencimiento          date,
  ADD COLUMN IF NOT EXISTS lugar_nacimiento               text,
  ADD COLUMN IF NOT EXISTS distrito                       text,
  ADD COLUMN IF NOT EXISTS emergency_contacts             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS isss_estado                    text,
  ADD COLUMN IF NOT EXISTS afp_estado                     text,
  ADD COLUMN IF NOT EXISTS medico_license_number          text,
  ADD COLUMN IF NOT EXISTS contador_license_number        text,
  ADD COLUMN IF NOT EXISTS tiene_acreditacion_dependiente boolean NOT NULL DEFAULT false;

-- NULL vale y significa «nadie preguntó». No se le pone default: un default
-- convertiría a las 49 fichas de hoy en «no tiene» sin que nadie lo haya
-- averiguado, que es exactamente lo que ya pasó con `contract_type` y las 44
-- horas.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_isss_estado_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_isss_estado_check
  CHECK (isss_estado IS NULL OR isss_estado IN ('TIENE','NO_TIENE','EN_TRAMITE'));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_afp_estado_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_afp_estado_check
  CHECK (afp_estado IS NULL OR afp_estado IN ('TIENE','NO_TIENE','EN_TRAMITE'));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_emergency_contacts_es_lista;
ALTER TABLE public.employees ADD CONSTRAINT employees_emergency_contacts_es_lista
  CHECK (jsonb_typeof(emergency_contacts) = 'array');

COMMENT ON COLUMN public.employees.dui_fecha_vencimiento IS 'Vencimiento del documento de identidad. Entra al aviso diario de vencimientos: un DUI vencido no sirve ante ISSS, AFP ni Hacienda.';
COMMENT ON COLUMN public.employees.lugar_nacimiento IS 'Anverso del DUI. Art. 23 nº1 pide domicilio y nacionalidad; el lugar de nacimiento se guarda porque el documento lo trae y lo piden varios trámites.';
COMMENT ON COLUMN public.employees.distrito IS 'Tercer nivel territorial (262 distritos). Mismo catálogo que la ficha fiscal del cliente: EL_SALVADOR_DISTRITOS.';
COMMENT ON COLUMN public.employees.emergency_contacts IS '[{nombre, parentesco, telefonos[]}]. La primera entrada espeja las columnas emergency_contact_* que lee el resto del portal.';
COMMENT ON COLUMN public.employees.isss_estado IS 'TIENE | NO_TIENE | EN_TRAMITE. NULL = nadie preguntó. Al ISSS lo inscribe el PATRONO.';
COMMENT ON COLUMN public.employees.afp_estado IS 'TIENE | NO_TIENE | EN_TRAMITE. NULL = nadie preguntó. La AFP la elige el TRABAJADOR: sólo él puede afiliarse.';
COMMENT ON COLUMN public.employees.medico_license_number IS 'Junta de Vigilancia de la Profesión Médica (CSSP).';
COMMENT ON COLUMN public.employees.contador_license_number IS 'Consejo de Vigilancia de la Profesión de Contaduría Pública y Auditoría — NO es del CSSP.';
COMMENT ON COLUMN public.employees.tiene_acreditacion_dependiente IS 'Acreditación de dependiente de farmacia (CSSP). Tiene trámite de REacreditación, o sea que vence.';

-- ── La vista publica todo menos el vencimiento del documento ─────────────────
--
-- `dui_fecha_vencimiento` viaja con el número del DUI, no con la vista: los dos
-- son el mismo dato del Art. 23 nº2 y se leen por `get_employee_identidad`,
-- detrás de la llave del expediente. Lo demás son categorías, no números: el
-- mismo corte que la vista ya hace con `account_type` y `afp_institution`.
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
    tiene_acreditacion_dependiente
   FROM public.employees;

-- ── La identidad suma el vencimiento del documento ──────────────────────────
DROP FUNCTION IF EXISTS public.get_employee_identidad(uuid[]);

CREATE FUNCTION public.get_employee_identidad(p_ids uuid[])
RETURNS TABLE(employee_id uuid, dui text, alt_identity_document text,
              isss_number text, afp_number text,
              dui_lugar_expedicion text, dui_fecha_expedicion date,
              dui_fecha_vencimiento date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
    v_yo      uuid;
    v_puede   boolean;
    v_alcance text;
BEGIN
    -- Las compuertas van envueltas en `(SELECT …)` — regla del incidente del
    -- 2026-07-08. Acá no es por velocidad sino por consistencia: la forma
    -- correcta se escribe siempre igual.
    v_yo    := (SELECT auth_employee_id());
    v_puede := (SELECT auth_has_module_permission('staff_detail', 'can_view'));

    IF v_puede THEN
        v_alcance := (SELECT auth_module_scope('staff_detail'));
    END IF;

    RETURN QUERY
    SELECT e.id, e.dui, e.alt_identity_document, e.isss_number, e.afp_number,
           e.dui_lugar_expedicion, e.dui_fecha_expedicion, e.dui_fecha_vencimiento
    FROM employees e
    WHERE e.id = ANY(p_ids)
      AND (
            -- Lo propio SIEMPRE: esconderle a alguien su propio documento no
            -- protege a nadie, rompe una pantalla.
            e.id = v_yo
            OR (v_puede AND (v_alcance = 'ALL'
                             OR e.branch_id = (SELECT auth_employee_branch_id())))
          );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_employee_identidad(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_employee_identidad(uuid[]) TO authenticated, service_role;
