SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- La identidad previsional sale de `employees_safe`
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Es lo que la migración del salario (20260823232630) dejó explícitamente
-- abierto: «`dui`, `afp_number` e `isss_number` se quedan […] Moverlos exige
-- decidir bajo qué llave van, y esa decisión no es de esta migración».
-- Esta la toma, con la medición delante.
--
-- ── Qué se midió, y por qué es PEOR que el caso del salario ────────────────
-- La policy de SELECT de `employees` es:
--     (NOT is_su del rol) OR (id = auth_employee_id())
-- O sea que CUALQUIER sesión lee las 47 filas que no son de un superusuario.
-- No hay recorte por sucursal en el servidor: `scopeToMyBranch` recorta en el
-- NAVEGADOR, así que no protege de nadie que abra la consola.
--
-- Con el salario la protección era una coincidencia de configuración —los
-- cuatro cargos que abren un expediente eran los cuatro que tenían la llave—.
-- Acá no hay coincidencia que valga: la vista es la que usa el login y la lee
-- todo el portal, así que el dato viaja a cualquiera con sesión.
--
-- Lo que la medición corrigió del propio hallazgo: hoy hay **4 DUI cargados y
-- CERO ISSS o AFP** sobre 49 filas. La puerta está abierta y casi no hay nada
-- detrás. Por eso se cierra AHORA — es el momento barato, igual que con el
-- salario: no le quita el dato a nadie. Medido: los 4 cargos que ven el
-- expediente (Administrador, Talento Humano, Supervisor/a de Ventas, QA) están
-- los cuatro en alcance ALL, y son los mismos cuatro que editan la lista.
--
-- ── Bajo qué llave van ──────────────────────────────────────────────────────
-- Bajo `staff_detail` («Expediente completo»), que es el módulo que gobierna
-- ver la ficha de alguien — y no `staff_salary`, que dice gatear ingresos.
--
-- Y con una diferencia que el salario no necesitaba: **uno SIEMPRE ve lo suyo**.
-- `EmployeeProfileView` («Mi perfil») muestra el DUI del propio empleado y lo
-- saca del padrón, que se llena de esta vista. Sin esa rama, cerrar la vista le
-- escondería a cada quien su propio número de documento — que no es proteger a
-- nadie, es romper una pantalla.
--
-- ── También sale `alt_identity_document` ────────────────────────────────────
-- Es el documento de quien no tiene DUI (Art. 23.2 CT, menores de edad). Es
-- exactamente la misma clase de dato, y dejarlo sería cerrar la puerta para los
-- adultos y no para los menores. Hoy hay 0 cargados.
--
-- NO salen: `alt_identity_document_type` (el tipo, no el número: sin él no
-- identifica), `afp_institution` (el nombre de la AFP) ni `birth_date` — esa
-- última la usa el widget de cumpleaños, y esconderla rompería una pantalla sin
-- proteger un identificador.
--
-- ── Por qué DROP y no CREATE OR REPLACE ────────────────────────────────────
-- Postgres no deja QUITAR columnas de una vista con `CREATE OR REPLACE`. Se
-- comprobó que NADA depende de `employees_safe` —ni vista, ni función, ni
-- policy: la única función que la nombra es `get_kiosk_coverage_employees`, y no
-- toca ninguno de los cuatro campos—, así que el DROP no arrastra nada y va
-- dentro de la transacción: no hay un instante en que el portal la encuentre
-- ausente.
--
-- Los GRANT se reponen idénticos. Recrear una vista los pierde, y perder el de
-- `authenticated` deja el portal entero sin poder leer empleados —incluido el
-- login, que resuelve el usuario contra esta vista—.

DROP VIEW public.employees_safe;

CREATE VIEW public.employees_safe
WITH (security_invoker = true) AS
 SELECT id, branch_id, shift_id, photo_url, phone, address, birth_date,
    status, hire_date, weekly_schedule, exceptions,
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
    srs_accreditation_expiry, nationality,
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
'La ficha de empleado que puede leer el portal. NO trae los datos de dinero (base_salary, bank_name, account_number): salieron el 2026-08-23 y viven detrás de get_employee_salarios, con la llave staff_salary. Tampoco trae `code` ni `kiosk_pin` — el código de carné ES la contraseña y salió antes, por el mismo motivo. Ni la identidad previsional (dui, alt_identity_document, isss_number, afp_number): salió el 2026-08-24 y vive detrás de get_employee_identidad, con la llave staff_detail — y ahí uno SIEMPRE ve lo suyo.';

CREATE OR REPLACE FUNCTION public.get_employee_identidad(p_ids uuid[])
RETURNS TABLE(employee_id uuid, dui text, alt_identity_document text,
              isss_number text, afp_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
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
    SELECT e.id, e.dui, e.alt_identity_document, e.isss_number, e.afp_number
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
$function$;

COMMENT ON FUNCTION public.get_employee_identidad(uuid[]) IS
'DUI, documento alterno, ISSS y AFP de un empleado. Salieron de employees_safe el 2026-08-24: la policy de SELECT de employees deja que CUALQUIER sesión lea las filas que no son de un superusuario, y el recorte por sucursal es del navegador. Sin la llave staff_detail devuelve sólo lo propio — nunca lanza, para que «no te toca» no se lea como «se rompió».';

REVOKE EXECUTE ON FUNCTION public.get_employee_identidad(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_employee_identidad(uuid[]) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y el aviso de DUI repetido, que sin esto se convierte en un error crudo
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `validateDui` (employeeSlice) buscaba el duplicado recorriendo el padrón que
-- el navegador ya tenía cargado. Sin `dui` en ese padrón no encontraría ninguno
-- **y no fallaría**: guardaría, y ahí recién saltaría el índice único de la base
-- con un error de Postgres en pantalla. Es el mismo modo de falla que tuvo el
-- código de carné, y la respuesta es la misma que se le dio: la pregunta la
-- contesta el servidor.
--
-- Dos cosas que hay que acertar y no son obvias:
--
-- 1. **Mira TODOS los estados, no sólo los activos.** `carne_disponible` filtra
--    por `status='ACTIVO'` y está bien para un carné —el de alguien dado de baja
--    se puede reusar—. Pero el índice `employees_dui_unique` NO filtra por
--    estado: es `WHERE dui IS NOT NULL` y nada más. Copiar el filtro de allá
--    diría «libre» sobre un DUI que la base va a rechazar un segundo después.
--
-- 2. **Compara por DÍGITOS.** El índice compara el texto tal cual, así que
--    `01234567-8` y `012345678` conviven para él. Para una persona son el mismo
--    documento. Acá se normaliza, así que esta función frena un caso más que el
--    índice — que es el lado correcto en el que equivocarse: dos fichas con el
--    mismo documento escrito distinto es exactamente lo que nadie va a notar.
--
-- Sin la llave devuelve `false` = «no disponible», igual que `carne_disponible`:
-- quien no puede editar personal no puede usar esto para averiguar si un
-- documento está en la nómina. Medido: los 4 cargos que editan la lista son los
-- mismos 4 que ven el expediente, así que no bloquea a nadie que hoy edite.

CREATE OR REPLACE FUNCTION public.dui_disponible(p_dui text, p_excluir uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT (SELECT auth_has_module_permission('staff_list','can_edit'))
       AND NOT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE (p_excluir IS NULL OR e.id <> p_excluir)
           AND regexp_replace(coalesce(e.dui,''), '\D', '', 'g')
             = regexp_replace(coalesce(p_dui,''), '\D', '', 'g')
           AND regexp_replace(coalesce(p_dui,''), '\D', '', 'g') <> ''
    );
$function$;

COMMENT ON FUNCTION public.dui_disponible(text, uuid) IS
'¿Este DUI está libre? Lo contesta el servidor desde el 2026-08-24, cuando `dui` salió de employees_safe: la comprobación vivía en el navegador cruzando contra el padrón cargado, y sin el dato ahí no encontraría nunca un choque. Mira TODOS los estados —el índice único no filtra por estado— y compara por dígitos, así que frena también el mismo documento escrito con otro formato. No dice de quién es.';

REVOKE EXECUTE ON FUNCTION public.dui_disponible(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dui_disponible(text, uuid) TO authenticated, service_role;
