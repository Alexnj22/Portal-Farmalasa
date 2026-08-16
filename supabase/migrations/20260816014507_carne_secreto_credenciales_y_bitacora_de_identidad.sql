-- Auditoría del circuito del efectivo (2026-08-15) — hallazgo 1.
--
-- El carné se queda como prueba de identidad (decisión del usuario: «necesito
-- siempre usar el carné, al final es personal de cada uno»). Para que pruebe
-- algo, el código tiene que ser un secreto — y hoy no lo es.
--
-- Medido en producción actuando como una Dependiente de Farmacia: 47 filas de
-- `employees_safe` visibles, las 47 con el código legible, más el `kiosk_pin`.
-- La policy `employees_select` no tiene compuerta de módulo ni alcance de sala;
-- el único filtro es esconder a los superusuarios. Y el código no es un
-- identificador cualquiera: `login()` hace `signInWithPassword(password: code)`,
-- así que leer el código de un compañero es entrar como esa persona. De 53
-- cuentas internas, 22 tienen la contraseña igual al código.
--
-- La vista no era barrera: es `security_invoker` y `employees` tenía SELECT
-- concedido aparte. El corte va por privilegio de COLUMNA sobre la tabla.
--
-- Verificado antes de aplicar, con la revocación dentro de una transacción
-- revertida: las 18 policies de otras tablas que referencian `employees`
-- (attendance, approval_requests, push_subscriptions, employee_rosters,
-- payroll_entries, employee_branches) y las funciones INVOKER siguen
-- respondiendo — ninguna necesita esas dos columnas.
SET lock_timeout = '5s';

-- ── 1. La vista deja de publicar las dos columnas ──────────────────────────
--
-- Se recrea en vez de editarse porque CREATE OR REPLACE VIEW no puede quitar
-- columnas. La lista sale del catálogo para que no haya que mantenerla a mano:
-- el día que se agregue una columna a `employees`, la vista la toma sola.
DO $$
DECLARE v_cols text;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='employees'
       AND column_name NOT IN ('code','kiosk_pin');

    EXECUTE 'DROP VIEW IF EXISTS public.employees_safe';
    EXECUTE format(
        'CREATE VIEW public.employees_safe WITH (security_invoker=true) AS SELECT %s FROM public.employees',
        v_cols);
END $$;

-- `anon` no vuelve a recibir nada: hoy no leía ninguna fila (la policy es TO
-- authenticated) pero el GRANT estaba puesto, y un GRANT sin uso es una puerta
-- esperando que alguien escriba la policy que la abra.
REVOKE ALL ON public.employees_safe FROM anon;
GRANT SELECT ON public.employees_safe TO authenticated;

-- ── 2. El corte de verdad: privilegio por columna sobre la tabla ───────────
--
-- ⚠️ CONSECUENCIA QUE HAY QUE CONOCER: al pasar de un GRANT de tabla a uno de
-- columnas, **una columna nueva de `employees` NO queda legible** hasta que se
-- vuelva a correr `regrant_employees_columns()`. Es a propósito —lo nuevo nace
-- privado— pero se rompe en silencio si nadie lo sabe. Por eso existe la
-- función: no hay que reescribir la lista, se la llama y ya.
CREATE OR REPLACE FUNCTION public.regrant_employees_columns()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_cols text; v_n integer;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position), count(*)
      INTO v_cols, v_n
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='employees'
       AND column_name NOT IN ('code','kiosk_pin');

    EXECUTE 'REVOKE SELECT ON public.employees FROM anon, authenticated';
    EXECUTE format('GRANT SELECT (%s) ON public.employees TO authenticated', v_cols);
    RETURN format('%s columnas legibles; code y kiosk_pin quedan fuera.', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.regrant_employees_columns() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.regrant_employees_columns() TO service_role;

SELECT public.regrant_employees_columns();

-- ── 3. Quién SÍ puede ver un código: quien administra el personal ──────────
--
-- `EmployeeFormModal` muestra y edita el código y el PIN, y tiene que seguir
-- pudiendo. Va por RPC con la misma compuerta que ya gobierna editar un
-- empleado (`staff_list.can_edit`) en vez de por la tabla, para que ver un
-- código sea una llamada explícita y no un efecto de traer la fila entera.
CREATE OR REPLACE FUNCTION public.get_employee_credenciales(p_ids uuid[])
 RETURNS TABLE(employee_id uuid, code text, kiosk_pin text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT e.id, e.code, e.kiosk_pin
      FROM public.employees e
     WHERE e.id = ANY(p_ids)
       AND (SELECT auth_has_module_permission('staff_list','can_edit'))
       AND ((SELECT auth_module_scope('staff_list')) = 'ALL'
            OR e.branch_id = (SELECT auth_employee_branch_id()));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_employee_credenciales(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_employee_credenciales(uuid[]) TO authenticated, service_role;

-- ── 4. «¿De quién es este carné?», sin entregar el mapa ────────────────────
--
-- Pedidos › Apoyo y Novedades escanean un carné para identificar a alguien.
-- Hasta hoy lo resolvían filtrando `employees` por `code`, que exige poder
-- leer la columna.
--
-- Un buscador así es un ORÁCULO: con códigos de 3 a 5 dígitos, quien pregunte
-- 100,000 veces reconstruye la tabla entera y el arreglo de arriba no habría
-- servido de nada. Por eso lleva tres frenos: contesta sólo por gente de la
-- sala de quien pregunta (que es lo que esos dos flujos necesitan — el carné
-- está físicamente ahí), deja registrado cada intento, y corta a los 20 fallos
-- en 15 minutos.
CREATE TABLE IF NOT EXISTS public.intentos_identidad (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at   timestamptz NOT NULL DEFAULT now(),
    quien        uuid REFERENCES public.employees(id),
    proposito    text NOT NULL,
    objetivo     uuid REFERENCES public.employees(id),
    metodo       text,
    exito        boolean NOT NULL,
    branch_id    bigint REFERENCES public.branches(id)
);

CREATE INDEX IF NOT EXISTS idx_intentos_identidad_quien   ON public.intentos_identidad(quien, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intentos_identidad_objetivo ON public.intentos_identidad(objetivo, created_at DESC);

ALTER TABLE public.intentos_identidad ENABLE ROW LEVEL SECURITY;

-- Append-only y de lectura restringida: es una bitácora de intentos fallidos de
-- probar la identidad de otra persona. La escribe sólo el servidor.
DROP POLICY IF EXISTS intentos_identidad_select ON public.intentos_identidad;
CREATE POLICY intentos_identidad_select ON public.intentos_identidad
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('auditview','can_view')));

REVOKE ALL ON public.intentos_identidad FROM anon, authenticated;
GRANT SELECT ON public.intentos_identidad TO authenticated;

CREATE OR REPLACE FUNCTION public.identificar_por_carne(p_valor text)
 RETURNS TABLE(id uuid, name text, first_names text, last_names text, photo_url text)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo    uuid := (SELECT auth_employee_id());
    v_sala  bigint := (SELECT auth_employee_branch_id());
    v_limpio text := upper(btrim(coalesce(p_valor,'')));
    v_fallos integer;
    v_hit   uuid;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF v_limpio = '' THEN RETURN; END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.quien = v_yo AND i.proposito = 'CARNE_LOOKUP'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 20 THEN
        RAISE EXCEPTION 'Demasiados carnes sin reconocer seguidos. Espera unos minutos.';
    END IF;

    SELECT e.id INTO v_hit
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND upper(btrim(coalesce(e.code,''))) = v_limpio
       AND btrim(coalesce(e.code,'')) <> ''
       AND (e.branch_id = v_sala
            OR EXISTS (SELECT 1 FROM public.employee_branches eb
                        WHERE eb.employee_id = e.id AND eb.branch_id = v_sala))
     LIMIT 1;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'CARNE_LOOKUP', v_hit, 'CARNE', v_hit IS NOT NULL, v_sala);

    RETURN QUERY
    SELECT e.id, e.name, e.first_names, e.last_names, e.photo_url
      FROM public.employees e WHERE e.id = v_hit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.identificar_por_carne(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.identificar_por_carne(text) TO authenticated, service_role;

-- ── 5. Probar identidad para retirar efectivo: bitácora y bloqueo ──────────
--
-- El problema del diseño anterior: `verificar_persona` se llamaba DENTRO de
-- `registrar_salida_de_bolsa`, que aborta la transacción cuando la clave no
-- coincide. Abortar revierte también cualquier registro del intento, así que
-- probar mil claves no dejaba una sola línea en ninguna parte y no había
-- contra qué contar para bloquear.
--
-- Se parte en dos: primero se prueba la identidad —esa llamada confirma sola y
-- deja su rastro— y devuelve un vale de un solo uso que vive 5 minutos. La
-- escritura del dinero recibe el vale, nunca el secreto.
CREATE TABLE IF NOT EXISTS public.identidad_vales (
    token      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    employee_id uuid NOT NULL REFERENCES public.employees(id),
    metodo     text NOT NULL,
    emitido_por uuid REFERENCES public.employees(id),
    usado_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_identidad_vales_empleado ON public.identidad_vales(employee_id, created_at DESC);

ALTER TABLE public.identidad_vales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identidad_vales FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.verificar_persona(p_employee_id uuid, p_metodo text, p_secreto text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
    v_ok boolean := false;
BEGIN
    IF p_employee_id IS NULL OR p_secreto IS NULL OR btrim(p_secreto) = '' THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_employee_id AND e.status = 'ACTIVO') THEN
        RETURN false;
    END IF;

    IF p_metodo = 'CARNE' THEN
        SELECT true INTO v_ok FROM public.employees e
         WHERE e.id = p_employee_id
           AND upper(btrim(coalesce(e.code, ''))) = upper(btrim(p_secreto))
           AND btrim(coalesce(e.code, '')) <> '';
        RETURN coalesce(v_ok, false);
    END IF;

    IF p_metodo = 'CLAVE' THEN
        SELECT true INTO v_ok
          FROM auth.users u
         WHERE u.encrypted_password IS NOT NULL
           AND u.encrypted_password = extensions.crypt(p_secreto, u.encrypted_password)
           AND (u.id = p_employee_id
                OR u.id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l
                             WHERE l.employee_id = p_employee_id))
         LIMIT 1;
        RETURN coalesce(v_ok, false);
    END IF;

    RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.verificar_persona(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verificar_persona(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.probar_identidad(p_employee_id uuid, p_metodo text, p_secreto text)
 RETURNS uuid
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_fallos integer;
    v_ok     boolean;
    v_token  uuid;
    v_sala   bigint;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_metodo IS NULL OR p_metodo NOT IN ('CARNE','CLAVE') THEN
        RAISE EXCEPTION 'Quien retira el efectivo se identifica con su carne o con su usuario y contrasena.';
    END IF;

    -- El freno cuenta los fallos contra ESA persona, no contra quien pregunta:
    -- lo que hay que encarecer es adivinarle el carne a alguien en concreto.
    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.objetivo = p_employee_id AND i.proposito = 'RETIRO'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 5 THEN
        INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
        VALUES (v_yo, 'RETIRO', p_employee_id, p_metodo, false, (SELECT auth_employee_branch_id()));
        RAISE EXCEPTION 'Se intento demasiadas veces sin acertar. Hay que esperar 15 minutos antes de volver a probar con esta persona.';
    END IF;

    v_ok := public.verificar_persona(p_employee_id, p_metodo, p_secreto);

    SELECT branch_id INTO v_sala FROM public.employees WHERE id = p_employee_id;
    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'RETIRO', p_employee_id, p_metodo, coalesce(v_ok,false), v_sala);

    IF NOT coalesce(v_ok, false) THEN
        RAISE EXCEPTION 'No se pudo comprobar la identidad de quien retira el efectivo.';
    END IF;

    INSERT INTO public.identidad_vales (employee_id, metodo, emitido_por)
    VALUES (p_employee_id, p_metodo, v_yo)
    RETURNING token INTO v_token;

    RETURN v_token;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.probar_identidad(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.probar_identidad(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.probar_identidad(uuid, text, text) IS
 'Prueba que alguien es quien dice —carne o contrasena— y devuelve un vale de un solo uso valido 5 minutos. Confirma su propia transaccion: por eso el intento fallido queda registrado aunque la operacion que sigue se aborte.';
COMMENT ON TABLE public.intentos_identidad IS
 'Cada vez que se prueba la identidad de alguien (retirar efectivo, reconocer un carne). Append-only. Es contra esto que se cuenta el bloqueo.';

-- ── 6. La escritura del dinero recibe el VALE, no la clave ─────────────────
--
-- Se borra la firma vieja en vez de dejar las dos: una sobrecarga que sigue
-- aceptando el secreto es exactamente el camino que se quiso cerrar, y quedaría
-- publicada en `/rest/v1/rpc/` esperando a que alguien la llame.
DROP FUNCTION IF EXISTS public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(
    p_tipo text, p_monto numeric, p_repartos jsonb,
    p_entidad text DEFAULT NULL, p_numero_boleta text DEFAULT NULL,
    p_foto_url text DEFAULT NULL, p_nota text DEFAULT NULL,
    p_recibido_por uuid DEFAULT NULL, p_metodo text DEFAULT NULL,
    p_vale uuid DEFAULT NULL)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    t public.bolsas_tipos_salida; v_oper public.bolsas_operaciones;
    v_yo uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia bigint := (SELECT auth_employee_branch_id());
    v_branch bigint; v_suma numeric := 0; v_codigo text; r record; b public.bolsas;
    v_vale public.identidad_vales;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.etiqueta_entidad IS NOT NULL AND btrim(coalesce(p_entidad,'')) = '' THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;
    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el número de boleta.'; END IF;
    IF t.pide_foto AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quién se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        -- El vale lo emitió `probar_identidad` y vale para UNA sola operación:
        -- se toma con FOR UPDATE y se marca usado en la misma transacción, así
        -- dos pestañas abiertas no pueden gastarlo dos veces.
        SELECT * INTO v_vale FROM public.identidad_vales
         WHERE token = p_vale FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
        IF v_vale.usado_at IS NOT NULL THEN
            RAISE EXCEPTION 'Esa comprobación ya se usó. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.created_at < now() - interval '5 minutes' THEN
            RAISE EXCEPTION 'La comprobación de identidad vencio. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.employee_id IS DISTINCT FROM p_recibido_por THEN
            RAISE EXCEPTION 'La identidad comprobada no es la de quien figura retirando el efectivo.'; END IF;

        UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de qué bolsa sale.'; END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;
        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF b.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'La bolsa % ya salió de la sala.', b.folio; END IF;
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sala.'; END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % sólo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00'); END IF;
        ELSIF t.signo = 1 THEN
            -- El tope de un reintegro es lo que salió: una bolsa no puede tener
            -- más de lo que se guardó en ella.
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_reintegro_maximo(b.id) THEN
                RAISE EXCEPTION 'A la bolsa % sólo le faltan %: una bolsa no puede tener más de lo que se guardó.',
                    b.folio, to_char(public.bolsa_reintegro_maximo(b.id), 'FM999,999,990.00'); END IF;
        END IF;
        v_suma := v_suma + r.monto;
    END LOOP;

    IF t.signo <> 0 AND round(v_suma, 2) <> round(p_monto, 2) THEN
        RAISE EXCEPTION 'Lo que sale de las bolsas (%) no cuadra con el monto (%).',
            to_char(v_suma, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00'); END IF;

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_operaciones
        (folio, branch_id, tipo, monto, entidad, numero_boleta, foto_url, nota,
         recibido_por, recibido_metodo, registrado_por)
    VALUES (t.prefijo || '-' || nextval('public.bolsas_operacion_folio_seq'),
         v_branch, t.codigo, round(p_monto, 2),
         nullif(btrim(coalesce(p_entidad,'')), ''), nullif(btrim(coalesce(p_numero_boleta,'')), ''),
         nullif(btrim(coalesce(p_foto_url,'')), ''), nullif(btrim(coalesce(p_nota,'')), ''),
         CASE WHEN t.pide_receptor THEN p_recibido_por END,
         CASE WHEN t.pide_receptor THEN coalesce(v_vale.metodo, p_metodo) END, v_yo)
    RETURNING * INTO v_oper;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        INSERT INTO public.bolsas_movimientos (bolsa_id, operacion_id, vale_folio, monto, registrado_por)
        VALUES (r.bolsa_id, v_oper.id,
                'V-' || v_codigo || '-' || nextval('public.bolsas_vale_folio_seq'),
                t.signo * r.monto, v_yo);
        UPDATE public.bolsas SET updated_at = now() WHERE id = r.bolsa_id;
        INSERT INTO public.bolsas_eventos (bolsa_id, accion, monto, employee_id, nota)
        VALUES (r.bolsa_id,
                CASE WHEN t.signo = 0 THEN 'ABRIR' WHEN t.signo = 1 THEN 'REINTEGRO' ELSE 'SALIDA' END,
                t.signo * r.monto, v_yo, t.etiqueta || ' · ' || v_oper.folio);
    END LOOP;

    RETURN v_oper;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid) TO authenticated, service_role;
