SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Una cadena vacía que llega a la puerta es un campo vacío, no un error
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `guardar_datos_protegidos_de_empleado` casteaba directo: `(p_patch->>'x')::numeric`
-- y `::date`. Con una cadena vacía eso **LANZA** —`invalid input syntax for type
-- numeric: ""`— y como la RPC es lo primero que corre al guardar una ficha, el
-- guardado entero se cae con un error que no nombra ni el campo ni la pantalla.
--
-- Hoy los cinco llamadores normalizan a `null` antes de mandar, así que no
-- llegaba. Pero eso es exactamente la clase de protección que se pierde sola: la
-- normalización está repartida en cinco archivos y basta que uno agregue un
-- camino nuevo —o que alguien llame la RPC desde otro lado— para que el borde
-- reaparezca. **La guarda va donde está el borde**, que es acá.
--
-- Y no es sólo defensa contra el error: `bank_name` y `account_number` son
-- `text`, así que una cadena vacía NO lanzaba — se guardaba. Una cuenta bancaria
-- que es `''` se lee después como «tiene cuenta» en cualquier `IS NOT NULL`, que
-- es `feedback_el_campo_vacio_viaja_como_cero` con otro tipo. Ahora los diez
-- campos entran por la misma regla: vacío es NULL.

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
    --
    -- Y `nullif(…, '')` en los diez: una cadena vacía es un campo que se dejó en
    -- blanco, no un valor. En `numeric` y en `date` casteada lanza y se lleva
    -- puesto el guardado entero; en los `text` no lanza, que es peor — guarda un
    -- `''` que después cualquier `IS NOT NULL` lee como «sí tiene cuenta».
    UPDATE public.employees e SET
        base_salary           = CASE WHEN p_patch ? 'base_salary'           THEN nullif(p_patch->>'base_salary', '')::numeric ELSE e.base_salary END,
        bank_name             = CASE WHEN p_patch ? 'bank_name'             THEN nullif(p_patch->>'bank_name', '')             ELSE e.bank_name END,
        account_number        = CASE WHEN p_patch ? 'account_number'        THEN nullif(p_patch->>'account_number', '')        ELSE e.account_number END,
        dui                   = CASE WHEN p_patch ? 'dui'                   THEN nullif(p_patch->>'dui', '')                   ELSE e.dui END,
        alt_identity_document = CASE WHEN p_patch ? 'alt_identity_document' THEN nullif(p_patch->>'alt_identity_document', '') ELSE e.alt_identity_document END,
        isss_number           = CASE WHEN p_patch ? 'isss_number'           THEN nullif(p_patch->>'isss_number', '')           ELSE e.isss_number END,
        afp_number            = CASE WHEN p_patch ? 'afp_number'            THEN nullif(p_patch->>'afp_number', '')            ELSE e.afp_number END,
        dui_lugar_expedicion  = CASE WHEN p_patch ? 'dui_lugar_expedicion'  THEN nullif(p_patch->>'dui_lugar_expedicion', '')  ELSE e.dui_lugar_expedicion END,
        dui_fecha_expedicion  = CASE WHEN p_patch ? 'dui_fecha_expedicion'  THEN nullif(p_patch->>'dui_fecha_expedicion', '')::date ELSE e.dui_fecha_expedicion END,
        dui_fecha_vencimiento = CASE WHEN p_patch ? 'dui_fecha_vencimiento' THEN nullif(p_patch->>'dui_fecha_vencimiento', '')::date ELSE e.dui_fecha_vencimiento END
    WHERE e.id = p_id;
END;
$function$;
