SET lock_timeout = '5s';

-- ═══ El carné de papel: un carné que sólo vale hoy ═══════════════════════════
--
-- Pedido del usuario (2026-08-20): imprimir el código de barras en la ticketera
-- al dar de alta a alguien que **todavía no tiene carné**, y desde el perfil de
-- cualquiera con un permiso propio. Y que ese papel **sólo funcione ese día**.
--
-- ── Por qué NO se imprime el carné de siempre ───────────────────────────────
-- El código de barras del carné plástico es el `kiosk_pin`, y ese valor ES la
-- contraseña del portal de esa persona: `ensure_user_by_code` abre la cuenta
-- `{pin}@staff.local` con `password = pin`. Imprimirlo en un ticket deja la
-- credencial permanente en un papel que queda sobre un mostrador, y no caduca
-- nunca. «Que valga sólo hoy» no es un ajuste de eso: pide una credencial
-- DISTINTA, y ésta es esa credencial.
--
-- ── Qué abre, y por qué eso obliga a que muera sola ─────────────────────────
-- Abre lo mismo que el carné (decisión del usuario): entrar al portal, marcar
-- en el kiosco, anotarse de apoyo en un pedido y recibir el efectivo. Por eso
-- el vencimiento no puede vivir sólo en la pantalla — vive acá, en las cuatro
-- funciones que leen un carné, y la cuenta que lo respalda se apaga sola.
--
-- ── El hash es SHA-256 y no bcrypt, a propósito ─────────────────────────────
-- Un PIN de 4 dígitos se guarda con bcrypt porque es adivinable y hay que
-- encarecer cada intento. Esto es al revés: son 10 caracteres sorteados de un
-- alfabeto de 31 (~49 bits), o sea que adivinarlo no es una opción y lo que sí
-- importa es que el lookup sea UNA comparación por índice. Con bcrypt habría
-- que probar el secreto contra CADA fila viva en cada escaneo — el kiosco lee
-- carnés todo el día.

-- ── 1. La marca «todavía no tiene carné» ───────────────────────────────────
--
-- `employees` no tiene SELECT a nivel de tabla para `authenticated` (sólo por
-- columna), así que una columna nueva NO se lee sola: hay que darle su grant o
-- el portal la vería siempre vacía, sin ningún error.
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS carne_pendiente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employees.carne_pendiente IS
 'Se marca al dar de alta a alguien cuyo carne plastico todavia no existe. Habilita imprimirle un carne de papel del dia sin el permiso carne_temporal.';

GRANT SELECT (carne_pendiente) ON public.employees TO authenticated;

-- Y la vista por la que el portal lee al personal ENUMERA sus columnas (no es
-- `*`: `code` y `kiosk_pin` quedaron fuera a propósito cuando dejaron de ser
-- legibles con la sesión del usuario). Sin agregarla acá, la casilla del
-- formulario saldría siempre apagada al editar a alguien — sin error, sin aviso
-- y sin forma de notarlo salvo abriendo la ficha de quien acaba de marcarse.
--
-- La lista NO se escribe a mano y ése es el punto: `CREATE OR REPLACE VIEW`
-- exige que las columnas que ya existen conserven nombre y ORDEN, así que una
-- lista copiada de un entorno falla en el otro en cuanto los dos divergen. Y
-- divergieron: medido el 2026-08-20, la vista de producción tiene 82 columnas y
-- la del branch de pruebas 79, con `code` y `kiosk_pin` todavía adentro. Acá se
-- lee la que HAY y se le agrega una al final.
DO $$
DECLARE v_cols text;
BEGIN
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'employees_safe';

    IF v_cols IS NULL THEN RETURN; END IF;                      -- no existe la vista
    IF v_cols LIKE '%carne_pendiente%' THEN RETURN; END IF;     -- ya la tiene

    EXECUTE format(
        'CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker = true) '
        'AS SELECT %s, carne_pendiente FROM public.employees', v_cols);
END $$;

-- ── 2. La tabla ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carnes_temporales (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    employee_id   uuid        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    -- SHA-256 en hexadecimal del valor en mayúsculas. El valor en claro se
    -- devuelve UNA vez, al emitirlo, y no se guarda en ninguna parte.
    secreto_hash  text        NOT NULL UNIQUE,
    vence_el      timestamptz NOT NULL,
    emitido_por   uuid        REFERENCES public.employees(id),
    branch_id     bigint      REFERENCES public.branches(id),
    -- Se anula al emitir uno nuevo (el papel viejo muere en el acto) o a mano.
    anulado_el    timestamptz,
    motivo        text,
    -- La cuenta que respalda a ESTE carné. La crea la edge function con la
    -- llave de servicio; se guarda acá para que la purga sepa a quién apagar.
    auth_user_id  uuid
);

CREATE INDEX IF NOT EXISTS idx_carnes_temporales_empleado
    ON public.carnes_temporales(employee_id, created_at DESC);
-- Los vivos: es la lista que recorre la purga y la que mira la pantalla.
CREATE INDEX IF NOT EXISTS idx_carnes_temporales_vigentes
    ON public.carnes_temporales(vence_el) WHERE anulado_el IS NULL;
CREATE INDEX IF NOT EXISTS idx_carnes_temporales_emitido_por
    ON public.carnes_temporales(emitido_por);
CREATE INDEX IF NOT EXISTS idx_carnes_temporales_branch
    ON public.carnes_temporales(branch_id);

ALTER TABLE public.carnes_temporales ENABLE ROW LEVEL SECURITY;

-- Append-only desde afuera: se escribe SÓLO por las funciones de abajo. Lo que
-- se puede leer es el registro de quién emitió qué y hasta cuándo vale — nunca
-- el secreto, que acá es un hash.
DROP POLICY IF EXISTS carnes_temporales_select ON public.carnes_temporales;
CREATE POLICY carnes_temporales_select ON public.carnes_temporales
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('carne_temporal','can_view'))
        OR (SELECT auth_has_module_permission('auditview','can_view'))
    );

REVOKE ALL ON public.carnes_temporales FROM anon, authenticated;
GRANT SELECT ON public.carnes_temporales TO authenticated;

COMMENT ON TABLE public.carnes_temporales IS
 'Carnes de papel que valen hasta medianoche del dia en que se imprimieron. El secreto se guarda hasheado (sha256) y se devuelve en claro una sola vez.';

-- ── 3. Emitir uno ──────────────────────────────────────────────────────────
--
-- Devuelve el secreto EN CLARO, y es la única vez que existe fuera del papel.
--
-- El permiso tiene dos puertas y no es un descuido:
--   · `carne_temporal.can_edit` — la del perfil, la que pidió el usuario.
--   · `staff_list.can_edit` + la persona marcada como que todavía no tiene
--     carné — la del alta. Quien da de alta ya puede ponerle código, cargo y
--     sucursal a esa ficha, así que no es una escalada; es la misma mano
--     terminando el mismo trámite.
CREATE OR REPLACE FUNCTION public.emitir_carne_temporal(
    p_employee_id uuid,
    p_motivo      text DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin 0/O ni 1/I/L: el valor va impreso debajo de las barras y alguien lo
    -- va a teclear el día que el lector no lo lea.
    c_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    c_largo    constant int  := 10;
    v_yo        uuid := (SELECT auth_employee_id());
    v_emp       record;
    v_puede     boolean;
    v_bytes     bytea;
    v_secreto   text := '';
    v_vence     timestamptz;
    v_id        bigint;
    i           int;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    SELECT e.id, e.name, e.status, e.branch_id, e.carne_pendiente
      INTO v_emp
      FROM public.employees e WHERE e.id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'No encontre a esa persona.';
    END IF;
    IF v_emp.status IS DISTINCT FROM 'ACTIVO' THEN
        RAISE EXCEPTION 'Esa persona no esta activa: no se le puede dar un carne.';
    END IF;

    v_puede := (SELECT auth_can_edit_any(ARRAY['carne_temporal']))
        OR (v_emp.carne_pendiente AND (SELECT auth_can_edit_any(ARRAY['staff_list'])));
    IF NOT v_puede THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    -- Hasta medianoche de HOY en El Salvador. Se calcula con el reloj del
    -- SERVIDOR: con el del navegador el vencimiento lo elegiría quien imprime.
    --
    -- El `::timestamp` NO es decorativo: sin él, `date AT TIME ZONE text`
    -- resuelve a la variante `timestamptz → timestamp`, que primero convierte la
    -- fecha con el huso de la SESIÓN y después le resta seis horas. Medido en
    -- staging: devolvía «2026-08-20 18:00», o sea el MEDIODÍA, y el carné habría
    -- vencido a mitad del turno sin que nada avisara. Con el cast explícito gana
    -- la variante `timestamp → timestamptz` y sale 06:00 UTC, que es medianoche
    -- en El Salvador.
    v_vence := (((now() AT TIME ZONE 'America/El_Salvador')::date + 1)::timestamp
                AT TIME ZONE 'America/El_Salvador');

    v_bytes := extensions.gen_random_bytes(c_largo);
    FOR i IN 1..c_largo LOOP
        v_secreto := v_secreto
            || substr(c_alfabeto, 1 + (get_byte(v_bytes, i - 1) % length(c_alfabeto)), 1);
    END LOOP;

    -- El papel anterior de esa persona muere en el acto. Dos papeles vivos del
    -- mismo carné es un papel que alguien creyó haber invalidado al reimprimir.
    UPDATE public.carnes_temporales
       SET anulado_el = now()
     WHERE employee_id = p_employee_id AND anulado_el IS NULL AND vence_el > now();

    INSERT INTO public.carnes_temporales
        (employee_id, secreto_hash, vence_el, emitido_por, branch_id, motivo)
    VALUES (
        p_employee_id,
        encode(extensions.digest(v_secreto, 'sha256'), 'hex'),
        v_vence, v_yo, v_emp.branch_id, nullif(btrim(coalesce(p_motivo,'')), '')
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'ok', true,
        'id', v_id,
        'secreto', v_secreto,
        'vence_el', v_vence,
        'employee_id', p_employee_id,
        'nombre', v_emp.name
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.emitir_carne_temporal(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emitir_carne_temporal(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.emitir_carne_temporal(uuid, text) IS
 'Emite un carne de papel que vale hasta medianoche (SV). Devuelve el secreto en claro una sola vez y anula el anterior de esa persona.';

-- ── 4. Apagar la cuenta que respalda un carné ──────────────────────────────
--
-- Anular la fila no alcanza: la cuenta `carne-<id>@staff.local` tiene por
-- contraseña el secreto impreso, y quien sepa el formato del correo puede ir
-- DIRECTO a Auth salteándose todo lo de acá — es exactamente el agujero que ya
-- está documentado para el carné de siempre. Así que apagar un carné es:
--   1. dejarle una contraseña que nadie conoce (un uuid sorteado), y
--   2. borrarle las sesiones, que es lo que invalida el refresh token.
-- El token de acceso que ya esté en un navegador vive lo que le quede de hora:
-- es el único hueco, y se cierra solo.
CREATE OR REPLACE FUNCTION public.apagar_cuenta_de_carne_temporal(p_auth_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF p_auth_user_id IS NULL THEN RETURN; END IF;

    UPDATE auth.users
       SET encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
           updated_at = now()
     WHERE id = p_auth_user_id;

    DELETE FROM auth.sessions WHERE user_id = p_auth_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apagar_cuenta_de_carne_temporal(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apagar_cuenta_de_carne_temporal(uuid) TO service_role;

-- ── 5. Anular uno a mano ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_carne_temporal(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo   uuid := (SELECT auth_employee_id());
    v_auth uuid;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF NOT (SELECT auth_can_edit_any(ARRAY['carne_temporal'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.carnes_temporales
       SET anulado_el = now()
     WHERE id = p_id AND anulado_el IS NULL
    RETURNING auth_user_id INTO v_auth;

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'motivo', 'Ese carne ya no estaba vigente.');
    END IF;

    PERFORM public.apagar_cuenta_de_carne_temporal(v_auth);
    RETURN json_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_carne_temporal(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_carne_temporal(bigint) TO authenticated, service_role;

-- ── 6. La purga de medianoche ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purgar_carnes_temporales()
 RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_cuenta integer := 0;
    r record;
BEGIN
    -- Una cuenta se apaga cuando NINGÚN carné suyo sigue vivo. Mirar carné por
    -- carné apagaría la cuenta de alguien que acaba de reimprimir el suyo.
    FOR r IN
        SELECT DISTINCT ct.auth_user_id
          FROM public.carnes_temporales ct
         WHERE ct.auth_user_id IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM public.carnes_temporales v
                 WHERE v.auth_user_id = ct.auth_user_id
                   AND v.anulado_el IS NULL AND v.vence_el > now())
    LOOP
        PERFORM public.apagar_cuenta_de_carne_temporal(r.auth_user_id);
        v_cuenta := v_cuenta + 1;
    END LOOP;

    -- El registro de quién imprimió qué se conserva 180 días: es la bitácora de
    -- una credencial, no un log de sync.
    DELETE FROM public.carnes_temporales
     WHERE vence_el < now() - interval '180 days';

    RETURN v_cuenta;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purgar_carnes_temporales() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purgar_carnes_temporales() TO service_role;

-- 00:10 en El Salvador = 06:10 UTC, dentro de la ventana donde los crons de
-- sync no corren.
SELECT cron.unschedule('purgar-carnes-temporales')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-carnes-temporales');
SELECT cron.schedule('purgar-carnes-temporales', '10 6 * * *',
    $$ SELECT public.purgar_carnes_temporales(); $$);

-- ── 7. «¿De quién es este carné de papel?» ─────────────────────────────────
--
-- La comparten los cuatro lugares que leen un carné. Una sola definición de
-- «vigente» — si viviera copiada en cuatro, el día que se agregue una condición
-- quedarían tres puertas con la regla vieja.
CREATE OR REPLACE FUNCTION public.resolver_carne_temporal(p_valor text)
 RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT ct.employee_id
      FROM public.carnes_temporales ct
      JOIN public.employees e ON e.id = ct.employee_id
     WHERE ct.secreto_hash = encode(extensions.digest(
                upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g')), 'sha256'), 'hex')
       AND ct.anulado_el IS NULL
       AND ct.vence_el > now()
       AND e.status = 'ACTIVO'
     LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_carne_temporal(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolver_carne_temporal(text) TO service_role;

COMMENT ON FUNCTION public.resolver_carne_temporal(text) IS
 'Devuelve a quien pertenece un carne de papel vigente, o NULL. No se le da a authenticated: seria un oraculo.';

-- ── 8. La cuenta que respalda al carné de papel ────────────────────────────
--
-- El correo es determinista —`carne-<id del empleado>@staff.local`— para que
-- haya UNA cuenta por persona en vez de una por papel: si cada impresión
-- creara la suya, en un año habría miles de cuentas muertas en Auth. Al
-- reimprimir se le cambia la contraseña, y eso mata el papel anterior en el
-- acto.
--
-- Existe porque la edge function necesita el id de esa cuenta y la API de
-- administración de Auth no busca por correo: sin esto habría que listar
-- usuarios y filtrar a mano.
CREATE OR REPLACE FUNCTION public.cuenta_de_carne_temporal(p_email text)
 RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT u.id FROM auth.users u WHERE u.email = lower(btrim(p_email)) LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.cuenta_de_carne_temporal(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cuenta_de_carne_temporal(text) TO service_role;
