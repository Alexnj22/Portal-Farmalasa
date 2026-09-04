SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- La ficha se LEE con tres llaves y se ESCRIBÍA con una
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La pantalla de Permisos ofrece tres módulos —Listado, Expediente, Salarios— y
-- de verdad separan lo que se VE: `get_employee_salarios` pide `staff_salary`,
-- `get_employee_identidad` pide `staff_detail`, y a `authenticated` se le revocó
-- el SELECT por columna de las doce sensibles.
--
-- La escritura nunca se partió. Las tres policies de `employees` piden lo mismo
-- —`staff_list.can_edit`— y el GRANT por columna quedó a medias: se revocó el
-- SELECT de las doce y se dejó INSERT y UPDATE sobre las doce. O sea que «Listado de personal ->
-- GESTIONAR», con Expediente y Salarios apagados, alcanzaba para cambiarle a
-- cualquiera el sueldo y la cuenta donde se le deposita, sin poder verlos.
--
-- ── Qué se revoca y qué NO ─────────────────────────────────────────────────
-- Se revocan DIEZ, no doce, y las dos que se quedan tienen su motivo:
--
--   · `code` ya está gobernado por la llave correcta. Es la credencial del
--     carné, su dueño es `staff_list.can_edit`, y eso es exactamente lo que la
--     policy de fila exige. Además es NOT NULL: sacarlo del INSERT dejaría el
--     alta sin poder crear a nadie.
--   · `kiosk_pin` no se revoca porque no hace falta: lo pasa a gobernar un
--     TRIGGER. Revocarlo además rompería la baja, que lo pone en NULL a
--     propósito para que la persona no pueda marcar.
--
-- ── Por qué el REVOKE va con su GRANT y no solo ────────────────────────────
-- Esto lo enseñó el ensayo en el branch, y es la trampa del paso: un
-- `REVOKE UPDATE (columna)` **no recorta** un `GRANT UPDATE` de tabla completa
-- —el privilegio de tabla sigue cubriendo todas las columnas— así que la
-- primera versión de esta migración no bloqueó absolutamente nada. Hay que
-- revocar el de TABLA y volver a conceder la lista, que es exactamente lo que
-- ya se había hecho con el SELECT en 2026-08-16 y 2026-08-24.
--
-- Consecuencia conocida y aceptada: **una columna nueva nace sin permiso de
-- escritura** hasta que alguien la agregue a la lista. Es el mismo trato que ya
-- tiene el SELECT, y falla cerrado.
--
-- ── El PIN dejaba de ser derivado en cuanto alguien quería ─────────────────
-- `kiosk_pin` es SHA-256(code) -> base64 -> sólo alfanuméricos -> mayúsculas ->
-- 8, y ese algoritmo vivía en TRES copias del navegador (`EmployeeFormModal`,
-- `FormNovedad`, `rehireEmployee`). El servidor lo guardaba tal cual, sin
-- recalcularlo: quien pudiera escribir la ficha podía mandar el PIN que
-- quisiera y el kiosco lo iba a aceptar. La debilidad ya estaba anotada en
-- `useTimeClockEngine.js` («derivable de un identificador visible en todo el
-- portal»); esto la cierra por el lado de la columna.
--
-- El trigger lo deriva SIEMPRE, así que las tres copias del cliente se borran y
-- los CINCO caminos que escriben el código —alta, edición, recontratación,
-- novedad de cambio de código y `apply-scheduled-employee-events`— quedan
-- cubiertos sin tocar ninguno.
--
-- Verificado contra producción ANTES de escribir nada: la derivación en
-- Postgres da el MISMO valor que la del navegador en las **46 fichas con PIN**,
-- 0 distintas. Sin esa comprobación, activar el trigger le habría cambiado el
-- PIN a todo el mundo.

-- ── 1. El PIN se deriva en el servidor ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derivar_kiosk_pin()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions
AS $function$
BEGIN
    -- La baja se respeta: `TERMINATION` pone `kiosk_pin` en NULL a propósito
    -- para que la persona no pueda marcar, y el código se le deja. Un NULL
    -- explícito sobre un PIN que existía es esa baja, no un descuido.
    IF TG_OP = 'UPDATE' AND NEW.kiosk_pin IS NULL AND OLD.kiosk_pin IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
        NEW.kiosk_pin := NULL;
        RETURN NEW;
    END IF;

    -- El mismo algoritmo que corría en el navegador, carácter por carácter:
    -- SHA-256 -> base64 -> se tiran los no alfanuméricos -> mayúsculas -> 8.
    NEW.kiosk_pin := left(
        upper(regexp_replace(
            encode(extensions.digest(NEW.code, 'sha256'), 'base64'),
            '[^A-Za-z0-9]', '', 'g')),
        8);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_derivar_kiosk_pin ON public.employees;
CREATE TRIGGER trg_derivar_kiosk_pin
    BEFORE INSERT OR UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.derivar_kiosk_pin();

-- ── 2. Las diez columnas dejan de ser escribibles con la sesión ────────────
-- La lista de las permitidas se calcula del catálogo en vez de escribirse a
-- mano: son ~98 y transcribirlas es una forma segura de olvidarse una y dejar
-- el portal sin poder guardar un campo, sin que nadie sepa cuál.
DO $$
DECLARE cols text;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY column_name) INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees'
      AND column_name <> ALL (ARRAY['base_salary','bank_name','account_number','dui',
            'alt_identity_document','dui_lugar_expedicion','dui_fecha_expedicion',
            'dui_fecha_vencimiento','isss_number','afp_number']);
    EXECUTE 'REVOKE INSERT, UPDATE ON public.employees FROM authenticated';
    EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.employees TO authenticated', cols, cols);
END $$;

-- ── 3. La puerta ────────────────────────────────────────────────────────────
--
-- UNA función y no tres, aunque la simetría con las tres de lectura invitaba a
-- lo contrario. El motivo es la ATOMICIDAD: con tres llamadas, el sueldo puede
-- entrar y la identidad fallar, y la ficha queda escrita por la mitad sin que
-- el navegador tenga forma de saber cuál mitad. Acá o entran las dos tandas o
-- no entra ninguna.
--
-- Y el mapa «qué llave gobierna qué columna» queda en UN solo lugar, al lado de
-- las policies, en vez de repetido en JavaScript. Una lista escrita dos veces se
-- desincroniza sola.
CREATE OR REPLACE FUNCTION public.guardar_datos_protegidos_de_empleado(
    p_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    k_salario   CONSTANT text[] := ARRAY['base_salary','bank_name','account_number'];
    k_identidad CONSTANT text[] := ARRAY['dui','alt_identity_document','isss_number','afp_number',
                                         'dui_lugar_expedicion','dui_fecha_expedicion','dui_fecha_vencimiento'];
    v_desconocida text;
    v_branch      bigint;
BEGIN
    IF p_id IS NULL OR p_patch IS NULL OR p_patch = '{}'::jsonb THEN
        RETURN;
    END IF;

    -- Una clave que no está en ninguna de las dos listas es un error de quien
    -- llama, no un campo que se ignora en silencio: si mañana alguien agrega una
    -- columna sensible y se olvida de declararla acá, tiene que enterarse.
    SELECT k INTO v_desconocida
    FROM jsonb_object_keys(p_patch) k
    WHERE NOT (k = ANY(k_salario) OR k = ANY(k_identidad))
    LIMIT 1;
    IF v_desconocida IS NOT NULL THEN
        RAISE EXCEPTION 'CAMPO_NO_PROTEGIDO: % no lo escribe esta función', v_desconocida;
    END IF;

    SELECT e.branch_id INTO v_branch FROM public.employees e WHERE e.id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_EXISTE: no hay ficha %', p_id;
    END IF;

    -- Sin la llave se LANZA, no se devuelve vacío. Es la diferencia con las
    -- funciones de lectura y es a propósito: una lectura que vuelve vacía
    -- muestra menos, pero una escritura que no escribe y no avisa es un
    -- guardado falso — la pantalla diría «guardado» sobre una ficha intacta.
    IF p_patch ?| k_salario THEN
        IF NOT (SELECT auth_can_edit_any(ARRAY['staff_salary']))
           OR NOT ((SELECT auth_module_scope('staff_salary')) = 'ALL'
                   OR v_branch = (SELECT auth_employee_branch_id())) THEN
            RAISE EXCEPTION 'FORBIDDEN: hace falta «Salarios e ingresos» para escribir el sueldo o la cuenta';
        END IF;
    END IF;

    IF p_patch ?| k_identidad THEN
        IF NOT (SELECT auth_can_edit_any(ARRAY['staff_detail']))
           OR NOT ((SELECT auth_module_scope('staff_detail')) = 'ALL'
                   OR v_branch = (SELECT auth_employee_branch_id())) THEN
            RAISE EXCEPTION 'FORBIDDEN: hace falta «Expediente completo» para escribir el documento de identidad';
        END IF;
    END IF;

    -- `?` distingue «no vino» de «vino en null», que es justo lo que un
    -- `coalesce` borraría: sin eso, guardar el sueldo limpiaría el DUI.
    UPDATE public.employees e SET
        base_salary           = CASE WHEN p_patch ? 'base_salary'           THEN (p_patch->>'base_salary')::numeric ELSE e.base_salary END,
        bank_name             = CASE WHEN p_patch ? 'bank_name'             THEN  p_patch->>'bank_name'             ELSE e.bank_name END,
        account_number        = CASE WHEN p_patch ? 'account_number'        THEN  p_patch->>'account_number'        ELSE e.account_number END,
        dui                   = CASE WHEN p_patch ? 'dui'                   THEN  p_patch->>'dui'                   ELSE e.dui END,
        alt_identity_document = CASE WHEN p_patch ? 'alt_identity_document' THEN  p_patch->>'alt_identity_document' ELSE e.alt_identity_document END,
        isss_number           = CASE WHEN p_patch ? 'isss_number'           THEN  p_patch->>'isss_number'           ELSE e.isss_number END,
        afp_number            = CASE WHEN p_patch ? 'afp_number'            THEN  p_patch->>'afp_number'            ELSE e.afp_number END,
        dui_lugar_expedicion  = CASE WHEN p_patch ? 'dui_lugar_expedicion'  THEN  p_patch->>'dui_lugar_expedicion'  ELSE e.dui_lugar_expedicion END,
        dui_fecha_expedicion  = CASE WHEN p_patch ? 'dui_fecha_expedicion'  THEN (p_patch->>'dui_fecha_expedicion')::date ELSE e.dui_fecha_expedicion END,
        dui_fecha_vencimiento = CASE WHEN p_patch ? 'dui_fecha_vencimiento' THEN (p_patch->>'dui_fecha_vencimiento')::date ELSE e.dui_fecha_vencimiento END
    WHERE e.id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guardar_datos_protegidos_de_empleado(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_datos_protegidos_de_empleado(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.guardar_datos_protegidos_de_empleado(uuid, jsonb) IS
'Escribe las diez columnas de la ficha que `authenticated` ya no puede tocar: el sueldo y la cuenta (llave staff_salary.can_edit) y la identidad previsional (llave staff_detail.can_edit). Es el gemelo de escritura de get_employee_salarios y get_employee_identidad. Sin la llave LANZA, no devuelve vacío: una escritura que no escribe y no avisa es un guardado falso.';

COMMENT ON FUNCTION public.derivar_kiosk_pin() IS
'kiosk_pin = SHA-256(code) en base64, sólo alfanuméricos, mayúsculas, 8 caracteres. Vivía en tres copias del navegador y el servidor lo guardaba tal cual, así que se podía inventar. Respeta el NULL explícito sobre un PIN que existía: eso es la baja.';
