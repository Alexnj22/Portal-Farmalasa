-- Lo que el Art. 23 del Código de Trabajo exige y el expediente no guardaba.
--
-- El formulario ya cubría once de los catorce numerales —incluido el 4º, que es
-- el que más se rompe (un contrato a plazo sin base legal ni motivo escrito lo
-- presume indefinido la ley)—. Faltaban cuatro datos, y ninguno tenía dónde
-- vivir:
--
--   2º  «Número, LUGAR Y FECHA DE EXPEDICIÓN» del documento de identidad.
--       Se guardaba sólo el número.
--   9º  «Forma, PERÍODO y lugar de pago». Estaban el banco, la cuenta y su
--       tipo —que son la forma y el lugar—; el período, no.
--  10º  «Cantidad, calidad y estado de las HERRAMIENTAS Y MATERIALES que el
--       patrono proporcione». Nada.
--  13º  «LUGAR Y FECHA DE CELEBRACIÓN del contrato». Existía
--       `contract_start_date`, que es el 5º —la fecha en que se INICIA el
--       trabajo— y no es lo mismo: se firma un día y se empieza otro.
--
-- Ninguno lleva valor por defecto a propósito. `contract_type` y
-- `weekly_contracted_hours` ya enseñaron esa lección: sus defaults
-- ('INDEFINIDO', 44) figuran hoy en las 49 filas y ninguno lo escribió nadie,
-- así que el expediente afirma un plazo y una jornada que nunca se pactaron.
-- Un campo vacío se ve; un default se confunde con un dato.

SET lock_timeout = '5s';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS dui_lugar_expedicion        text,
  ADD COLUMN IF NOT EXISTS dui_fecha_expedicion        date,
  ADD COLUMN IF NOT EXISTS periodo_pago                text,
  ADD COLUMN IF NOT EXISTS herramientas_entregadas     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contrato_lugar_celebracion  text,
  ADD COLUMN IF NOT EXISTS contrato_fecha_celebracion  date;

-- NULL vale: es «todavía no se pactó», que es distinto de cada uno de los tres
-- valores y es el estado real de las 49 fichas de hoy.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_periodo_pago_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_periodo_pago_check
  CHECK (periodo_pago IS NULL OR periodo_pago IN ('SEMANAL','QUINCENAL','MENSUAL'));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_herramientas_es_lista;
ALTER TABLE public.employees ADD CONSTRAINT employees_herramientas_es_lista
  CHECK (jsonb_typeof(herramientas_entregadas) = 'array');

COMMENT ON COLUMN public.employees.dui_lugar_expedicion       IS 'Art. 23 nº2 CT — lugar de expedición del documento de identidad.';
COMMENT ON COLUMN public.employees.dui_fecha_expedicion       IS 'Art. 23 nº2 CT — fecha de expedición del documento de identidad.';
COMMENT ON COLUMN public.employees.periodo_pago               IS 'Art. 23 nº9 CT — período de pago. NULL = no pactado todavía.';
COMMENT ON COLUMN public.employees.herramientas_entregadas    IS 'Art. 23 nº10 CT — [{descripcion, cantidad, estado}]. Cantidad, calidad y estado de lo que entrega el patrono.';
COMMENT ON COLUMN public.employees.contrato_lugar_celebracion IS 'Art. 23 nº13 CT — lugar donde se firmó. No es la sucursal donde trabaja.';
COMMENT ON COLUMN public.employees.contrato_fecha_celebracion IS 'Art. 23 nº13 CT — fecha de firma. Distinta del nº5 (contract_start_date), que es cuándo empieza a trabajar.';

-- ── La vista publica los cuatro que NO son identidad ─────────────────────────
--
-- El lugar y la fecha de expedición van con el número del documento: son el
-- mismo dato del Art. 23 nº2 y se leen por `get_employee_identidad`, detrás de
-- la llave del expediente. Publicarlos acá sería deshacer a medias la mudanza
-- del 2026-08-24 — el documento de identidad de 47 personas viajaba a
-- cualquiera que abriera la consola.
--
-- Los otros cuatro son cláusulas del contrato, no secretos. Y siguen el corte
-- que ya existe en esta vista para el dinero: la CATEGORÍA se publica
-- (`account_type`, `afp_institution`), el NÚMERO no (`account_number`,
-- `afp_number`). «Quincenal» es categoría; el monto sigue en su RPC.
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
    contrato_lugar_celebracion, contrato_fecha_celebracion
   FROM public.employees;

-- ── La identidad suma lugar y fecha de expedición ────────────────────────────
--
-- Cambia el RETURNS TABLE, así que hay DROP: `CREATE OR REPLACE` no puede
-- alterar el tipo de retorno. Los argumentos son los mismos (`uuid[]`), o sea
-- que no queda una sobrecarga vieja con sus permisos intactos — que es
-- exactamente cómo `update_proveedor_manual` terminó con dos firmas y la
-- revocación alcanzando a una sola.
DROP FUNCTION IF EXISTS public.get_employee_identidad(uuid[]);

CREATE FUNCTION public.get_employee_identidad(p_ids uuid[])
RETURNS TABLE(employee_id uuid, dui text, alt_identity_document text,
              isss_number text, afp_number text,
              dui_lugar_expedicion text, dui_fecha_expedicion date)
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
    -- correcta se escribe siempre igual, para que la excepción no parezca
    -- normal en la próxima función.
    v_yo    := (SELECT auth_employee_id());
    v_puede := (SELECT auth_has_module_permission('staff_detail', 'can_view'));

    IF v_puede THEN
        v_alcance := (SELECT auth_module_scope('staff_detail'));
    END IF;

    RETURN QUERY
    SELECT e.id, e.dui, e.alt_identity_document, e.isss_number, e.afp_number,
           e.dui_lugar_expedicion, e.dui_fecha_expedicion
    FROM employees e
    WHERE e.id = ANY(p_ids)
      AND (
            -- Lo propio SIEMPRE. Es lo que hace que «Mi perfil» siga mostrando
            -- el documento de uno: esconderle a alguien su propio número no
            -- protege a nadie, rompe una pantalla.
            e.id = v_yo
            -- O la llave del expediente, respetando su alcance. Se escribe
            -- ahora aunque los cuatro cargos que la tienen estén en ALL: el día
            -- que se le dé a una jefatura de sala con alcance BRANCH, tiene que
            -- ver los suyos y nada más.
            OR (v_puede AND (v_alcance = 'ALL'
                             OR e.branch_id = (SELECT auth_employee_branch_id())))
          );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_employee_identidad(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_employee_identidad(uuid[]) TO authenticated, service_role;
