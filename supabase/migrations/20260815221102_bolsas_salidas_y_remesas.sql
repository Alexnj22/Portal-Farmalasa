-- Bolsas de efectivo — F4: sacar dinero de una bolsa.
--
-- Pedido del usuario: cuando hay que entregar una remesa y la caja no alcanza,
-- se saca de una bolsa y hoy queda un papel escrito a mano. Esto lo reemplaza.
--
-- REMESA = la sala le ENTREGA efectivo al cliente con un POS de un banco
-- (corregido por el usuario el 2026-08-15; no es un deposito bancario). La
-- consecuencia manda: lo que queda dentro de la bolsa no es un pagare interno,
-- es un comprobante del banco, y vale tanto como el billete que salio.
--
-- ── La remesa es un HECHO; los vales son de donde salio la plata ────────────
-- Dos tablas y no una. Una remesa puede salir de mas de una bolsa —«se tomaron
-- 2 bolsas», pregunto el usuario— y si el banco, la boleta y la foto vivieran
-- dentro de cada salida serian dos copias del mismo dato. Se desincronizan.
--
--   bolsas_operaciones  el hecho: monto, banco, boleta, foto, quien lo recibio
--   bolsas_movimientos  un vale por bolsa, con signo
--
-- El servidor exige que la suma de los vales sea EXACTAMENTE el monto de la
-- operacion: sin eso, un vale puede quedar por menos de lo que se saco.
--
-- Probada en el branch de staging con una transaccion revertida: la clave se
-- comprueba en el servidor (buena=t, mala=f, carne=t), una salida de 200 deja la
-- bolsa de 300 en 100, y `bolsa_sugerida` del corte siguiente NO se mueve.

SET lock_timeout = '5s';

-- ── El catalogo ─────────────────────────────────────────────────────────────
--
-- Es una TABLA y no una lista en el codigo porque de ella sale el formulario:
-- que campos exige cada tipo son datos, no `if`s. Regla del proyecto — una
-- lista de opciones que existe como tabla no se escribe a mano.
CREATE TABLE IF NOT EXISTS public.bolsas_tipos_salida (
    codigo           text PRIMARY KEY,
    etiqueta         text    NOT NULL,
    prefijo          text    NOT NULL,
    -- -1 sale de la bolsa · +1 entra · 0 no mueve el saldo (el cambio de
    -- sencillo: no cambia el total pero rompe el sello, y eso hay que verlo).
    signo            smallint NOT NULL DEFAULT -1 CHECK (signo IN (-1, 0, 1)),
    -- NULL = no pide entidad. El rotulo viaja con el dato para que el
    -- formulario diga «Banco» en una remesa y «Proveedor» en un pago.
    etiqueta_entidad text,
    pide_boleta      boolean NOT NULL DEFAULT false,
    pide_foto        boolean NOT NULL DEFAULT false,
    -- En una remesa quien recibe es el CLIENTE y lo identifica la boleta del
    -- POS; en los demas, quien retira el efectivo se identifica en el portal.
    pide_receptor    boolean NOT NULL DEFAULT true,
    orden            smallint NOT NULL DEFAULT 100,
    activo           boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bolsas_tipos_salida ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bolsas_tipos_select ON public.bolsas_tipos_salida;
CREATE POLICY bolsas_tipos_select ON public.bolsas_tipos_salida
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('bolsas','can_view')));

DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_tipos_salida;
CREATE POLICY bloqueo_global ON public.bolsas_tipos_salida
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

REVOKE ALL ON public.bolsas_tipos_salida FROM anon;
GRANT SELECT ON public.bolsas_tipos_salida TO authenticated;
GRANT ALL ON public.bolsas_tipos_salida TO service_role;

INSERT INTO public.bolsas_tipos_salida
    (codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, pide_foto, pide_receptor, orden)
VALUES
    ('REMESA',          'Remesa entregada a un cliente', 'REM', -1, 'Banco',     true,  true,  false, 10),
    ('PAGO_PROVEEDOR',  'Pago a proveedor',              'PAG', -1, 'Proveedor', true,  true,  true,  20),
    ('GASTO',           'Gasto o compra urgente',        'GAS', -1, NULL,        true,  true,  true,  30),
    ('ENVIO_SALA',      'Envio de efectivo a otra sala', 'ENV', -1, NULL,        false, true,  true,  40),
    ('ANTICIPO',        'Anticipo a un empleado',        'ANT', -1, NULL,        false, false, true,  50),
    ('OTRO',            'Otro',                          'OTR', -1, NULL,        false, true,  true,  60),
    -- Dinero que vuelve: una remesa que no se concreto, o la reposicion de un
    -- faltante.
    ('REINTEGRO',       'Dinero que vuelve a la bolsa',  'REI',  1, NULL,        false, false, false, 70),
    -- No mueve el saldo, pero rompe el sello. Sin registrarlo, cada apertura
    -- legitima se ve igual que ninguna.
    ('CAMBIO_SENCILLO', 'Se abrio para cambiar sencillo','CAM',  0, NULL,        false, false, false, 80)
ON CONFLICT (codigo) DO NOTHING;

-- `REPOSICION_CAJA` NO existe a proposito: devolverle dinero al cajon lo hace
-- reaparecer en el conteo del corte siguiente, y de ahi se embolsa OTRA VEZ. El
-- mismo billete contado dos veces, sin que ninguna cuenta lo delate. Si al cajon
-- le falta sencillo, eso es `CAMBIO_SENCILLO`.

CREATE SEQUENCE IF NOT EXISTS public.bolsas_operacion_folio_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS public.bolsas_vale_folio_seq START 1000;

CREATE TABLE IF NOT EXISTS public.bolsas_operaciones (
    id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    folio          text    NOT NULL UNIQUE,
    branch_id      bigint  NOT NULL REFERENCES public.branches(id),
    tipo           text    NOT NULL REFERENCES public.bolsas_tipos_salida(codigo),
    -- SIEMPRE positivo: el signo lo pone el tipo. Guardar el signo dos veces es
    -- garantizar que un dia no coincidan.
    monto          numeric(12,2) NOT NULL CHECK (monto >= 0),
    entidad        text,
    numero_boleta  text,
    foto_url       text,
    nota           text,
    -- Quien se llevo el efectivo, y COMO se probo que era el.
    recibido_por    uuid REFERENCES public.employees(id),
    recibido_metodo text CHECK (recibido_metodo IS NULL OR recibido_metodo IN ('CARNE','CLAVE')),
    registrado_por uuid REFERENCES public.employees(id),
    registrado_at  timestamptz NOT NULL DEFAULT now(),
    anulada_at     timestamptz,
    anulada_por    uuid REFERENCES public.employees(id),
    anulada_motivo text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bolsas_oper_branch ON public.bolsas_operaciones(branch_id, registrado_at DESC);
CREATE INDEX IF NOT EXISTS bolsas_oper_tipo   ON public.bolsas_operaciones(tipo);
CREATE INDEX IF NOT EXISTS bolsas_oper_receptor ON public.bolsas_operaciones(recibido_por);
CREATE INDEX IF NOT EXISTS bolsas_oper_registrado ON public.bolsas_operaciones(registrado_por);

ALTER TABLE public.bolsas_operaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bolsas_oper_select ON public.bolsas_operaciones;
CREATE POLICY bolsas_oper_select ON public.bolsas_operaciones
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('bolsas','can_view'))
        AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
             OR branch_id = (SELECT auth_employee_branch_id()))
    );

DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_operaciones;
CREATE POLICY bloqueo_global ON public.bolsas_operaciones
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

REVOKE ALL ON public.bolsas_operaciones FROM anon;
GRANT SELECT ON public.bolsas_operaciones TO authenticated;
GRANT ALL ON public.bolsas_operaciones TO service_role;

CREATE TABLE IF NOT EXISTS public.bolsas_movimientos (
    id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    bolsa_id       bigint  NOT NULL REFERENCES public.bolsas(id),
    operacion_id   bigint  REFERENCES public.bolsas_operaciones(id),
    vale_folio     text    NOT NULL UNIQUE,
    -- CON SIGNO: negativo sale, positivo entra. Con signo y no dos tablas
    -- porque hay tres casos que no son salidas y tienen que caber — el
    -- reintegro, la devolucion, y la reposicion de un faltante.
    monto          numeric(12,2) NOT NULL,
    registrado_por uuid REFERENCES public.employees(id),
    registrado_at  timestamptz NOT NULL DEFAULT now(),
    impreso_at     timestamptz,
    anulado_at     timestamptz,
    anulado_por    uuid REFERENCES public.employees(id),
    anulado_motivo text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bolsas_mov_bolsa ON public.bolsas_movimientos(bolsa_id) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS bolsas_mov_oper  ON public.bolsas_movimientos(operacion_id);
CREATE INDEX IF NOT EXISTS bolsas_mov_registrado ON public.bolsas_movimientos(registrado_por);

ALTER TABLE public.bolsas_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bolsas_mov_select ON public.bolsas_movimientos;
CREATE POLICY bolsas_mov_select ON public.bolsas_movimientos
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.bolsas b WHERE b.id = bolsas_movimientos.bolsa_id));

DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_movimientos;
CREATE POLICY bloqueo_global ON public.bolsas_movimientos
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

REVOKE ALL ON public.bolsas_movimientos FROM anon;
GRANT SELECT ON public.bolsas_movimientos TO authenticated;
GRANT ALL ON public.bolsas_movimientos TO service_role;

-- ── El saldo, ahora de verdad ───────────────────────────────────────────────
--
-- Lo que DEBE haber en billetes: lo guardado menos lo que salio. El resto del
-- contenido de la bolsa son los comprobantes, que valen lo mismo pero no se
-- cuentan como efectivo.
--
-- Ya existia devolviendo `monto_inicial` a secas, y estaba separada justamente
-- para que este cambio fuera de UNA linea y en UN lugar: quien cuenta y quien
-- imprime la etiqueta tienen que leer el mismo numero.
CREATE OR REPLACE FUNCTION public.bolsa_saldo(p_bolsa_id bigint)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT round(b.monto_inicial + coalesce((
        SELECT sum(m.monto) FROM public.bolsas_movimientos m
         WHERE m.bolsa_id = b.id AND m.anulado_at IS NULL
    ), 0), 2)
      FROM public.bolsas b WHERE b.id = p_bolsa_id;
$$;

REVOKE EXECUTE ON FUNCTION public.bolsa_saldo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolsa_saldo(bigint) TO authenticated, service_role;

-- `bolsa_sugerida` NO cambia, y eso es deliberado. Suma `monto_inicial`, no el
-- saldo: el vale ocupa el lugar del billete, asi que el corte siguiente cuenta
-- ese dinero igual y su declarado acumulado lo incluye. Restar el saldo
-- descontaria dos veces lo que salio y la bolsa siguiente naceria inflada.
-- Verificado en staging: con 200 fuera de la primera bolsa, la sugerida del
-- corte siguiente sigue dando lo mismo.
COMMENT ON FUNCTION public.bolsa_sugerida(bigint) IS
    'Cuanto falta por embolsar de un corte. Suma monto_inicial y NO el saldo: el vale ocupa el lugar del billete, asi que el declarado del corte siguiente ya lo incluye.';

-- ── Probar que quien retira el dinero es quien dice ser ─────────────────────
--
-- Decision del usuario (2026-08-15): «no escoge de la lista de empleados, debe
-- escribir el usuario y la contraseña, asi nos aseguramos que si sea el». Elegir
-- un nombre de una lista lo hace cualquiera que sepa escribirlo: es
-- identificacion, no prueba.
--
-- Se comprueba ACA y no en el navegador por dos razones. Una, que el navegador
-- diciendo «ya lo verifique» no es una verificacion. Y dos, `signInWithPassword`
-- en el cliente de siempre REEMPLAZA la sesion abierta: la sala quedaria
-- logueada como quien vino a retirar el dinero, en medio de una operacion de
-- caja.
--
-- La clave no se guarda, no se registra y no viaja a ninguna tabla: llega, se
-- compara contra el hash y se descarta. Tampoco queda como oraculo suelto — es
-- PRIVADA (sin EXECUTE para `authenticated`) y solo la llama la funcion que
-- escribe, asi que cada intento cuesta una operacion entera y bcrypt es lento a
-- proposito.
--
-- `CARNE` compara contra el codigo del carne, que es lo que sale del lector. Ese
-- numero tampoco se guarda: se resuelve a la persona y se descarta.
CREATE OR REPLACE FUNCTION public.verificar_persona(
    p_employee_id uuid,
    p_metodo      text,
    p_secreto     text
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.verificar_persona(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_persona(uuid, text, text) TO service_role;

-- ── Sacar dinero de una o mas bolsas ────────────────────────────────────────
--
-- `p_repartos` es `[{ "bolsa_id": 1, "monto": 300 }, …]` — de que bolsas sale.
-- La regla del usuario es la mas vieja que ALCANCE SOLA; combinar es la
-- excepcion, para cuando ninguna alcanza. La eleccion la hace la pantalla; aca
-- se valida que la suma cierre y que cada bolsa tenga con que.
CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(
    p_tipo          text,
    p_monto         numeric,
    p_repartos      jsonb,
    p_entidad       text    DEFAULT NULL,
    p_numero_boleta text    DEFAULT NULL,
    p_foto_url      text    DEFAULT NULL,
    p_nota          text    DEFAULT NULL,
    p_recibido_por  uuid    DEFAULT NULL,
    p_metodo        text    DEFAULT NULL,
    p_secreto       text    DEFAULT NULL
)
RETURNS public.bolsas_operaciones
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    t        public.bolsas_tipos_salida;
    v_oper   public.bolsas_operaciones;
    v_yo     uuid := (SELECT auth_employee_id());
    v_scope  text := (SELECT auth_module_scope('bolsas'));
    v_mia    bigint := (SELECT auth_employee_branch_id());
    v_branch bigint;
    v_suma   numeric := 0;
    v_codigo text;
    r        record;
    b        public.bolsas;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;

    IF p_monto IS NULL OR p_monto < 0 THEN
        RAISE EXCEPTION 'Hay que decir cuánto.';
    END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN
        RAISE EXCEPTION 'Hay que decir cuánto.';
    END IF;

    -- Lo que exige el tipo, que son DATOS y no `if`s escritos a mano.
    IF t.etiqueta_entidad IS NOT NULL AND btrim(coalesce(p_entidad,'')) = '' THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad;
    END IF;
    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el número de boleta.';
    END IF;
    IF t.pide_foto AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.';
    END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN
            RAISE EXCEPTION 'Falta quién se lleva el efectivo.';
        END IF;
        IF p_metodo IS NULL OR p_metodo NOT IN ('CARNE','CLAVE') THEN
            RAISE EXCEPTION 'Quien retira el efectivo se identifica con su carné o con su usuario y contraseña.';
        END IF;
        IF NOT public.verificar_persona(p_recibido_por, p_metodo, p_secreto) THEN
            RAISE EXCEPTION 'No se pudo comprobar la identidad de quien retira el efectivo.';
        END IF;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de qué bolsa sale.';
    END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id,
                    round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP

        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;

        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;

        -- Una bolsa entregada ya no esta en la sala: registrar una salida ahi es
        -- imposible en el mundo real.
        IF b.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salió de la sala.', b.folio;
        END IF;

        -- Todas las bolsas de una operacion tienen que ser de la MISMA sala: un
        -- vale que cruza de sucursal no lo puede firmar nadie.
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sala.';
        END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % sólo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00');
            END IF;
        END IF;

        v_suma := v_suma + r.monto;
    END LOOP;

    IF t.signo <> 0 AND round(v_suma, 2) <> round(p_monto, 2) THEN
        RAISE EXCEPTION 'Lo que sale de las bolsas (%) no cuadra con el monto (%).',
            to_char(v_suma, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00');
    END IF;

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo
      FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_operaciones
        (folio, branch_id, tipo, monto, entidad, numero_boleta, foto_url, nota,
         recibido_por, recibido_metodo, registrado_por)
    VALUES
        (t.prefijo || '-' || nextval('public.bolsas_operacion_folio_seq'),
         v_branch, t.codigo, round(p_monto, 2),
         nullif(btrim(coalesce(p_entidad,'')), ''),
         nullif(btrim(coalesce(p_numero_boleta,'')), ''),
         nullif(btrim(coalesce(p_foto_url,'')), ''),
         nullif(btrim(coalesce(p_nota,'')), ''),
         CASE WHEN t.pide_receptor THEN p_recibido_por END,
         CASE WHEN t.pide_receptor THEN p_metodo END,
         v_yo)
    RETURNING * INTO v_oper;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id,
                    round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP

        INSERT INTO public.bolsas_movimientos
            (bolsa_id, operacion_id, vale_folio, monto, registrado_por)
        VALUES (r.bolsa_id, v_oper.id,
                'V-' || v_codigo || '-' || nextval('public.bolsas_vale_folio_seq'),
                t.signo * r.monto, v_yo);

        -- La etiqueta pegada afuera deja de ser cierta en cuanto sale plata.
        UPDATE public.bolsas SET updated_at = now() WHERE id = r.bolsa_id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, monto, employee_id, nota)
        VALUES (r.bolsa_id,
                CASE WHEN t.signo = 0 THEN 'ABRIR' WHEN t.signo = 1 THEN 'REINTEGRO' ELSE 'SALIDA' END,
                t.signo * r.monto, v_yo, t.etiqueta || ' · ' || v_oper.folio);
    END LOOP;

    RETURN v_oper;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, text) TO authenticated, service_role;

-- ── Anular una salida ───────────────────────────────────────────────────────
--
-- Se anula, nunca se borra: el vale ya salio impreso y esta dentro de la bolsa.
CREATE OR REPLACE FUNCTION public.anular_salida_de_bolsa(p_operacion_id bigint, p_motivo text)
RETURNS public.bolsas_operaciones
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_oper  public.bolsas_operaciones;
    v_yo    uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    r       record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular una salida exige decir por qué.';
    END IF;

    SELECT * INTO v_oper FROM public.bolsas_operaciones WHERE id = p_operacion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa salida no existe.'; END IF;
    IF v_oper.anulada_at IS NOT NULL THEN RAISE EXCEPTION 'Esa salida ya está anulada.'; END IF;

    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_oper.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- Solo mientras las bolsas sigan en la sala: si ya se entregaron, el dinero
    -- lo tiene otro y la correccion es del conteo, no de aca.
    FOR r IN SELECT b.folio, b.estado FROM public.bolsas_movimientos m
              JOIN public.bolsas b ON b.id = m.bolsa_id
             WHERE m.operacion_id = p_operacion_id AND m.anulado_at IS NULL LOOP
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salió de la sala: esta salida no se puede anular.', r.folio;
        END IF;
    END LOOP;

    UPDATE public.bolsas_movimientos
       SET anulado_at = now(), anulado_por = v_yo, anulado_motivo = btrim(p_motivo)
     WHERE operacion_id = p_operacion_id AND anulado_at IS NULL;

    UPDATE public.bolsas_operaciones
       SET anulada_at = now(), anulada_por = v_yo, anulada_motivo = btrim(p_motivo),
           updated_at = now()
     WHERE id = p_operacion_id
     RETURNING * INTO v_oper;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, motivo, monto, employee_id, nota)
    SELECT m.bolsa_id, 'ANULAR_SALIDA', btrim(p_motivo), -m.monto, v_yo, v_oper.folio
      FROM public.bolsas_movimientos m WHERE m.operacion_id = p_operacion_id;

    RETURN v_oper;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anular_salida_de_bolsa(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_salida_de_bolsa(bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.marcar_vale_impreso(p_movimiento_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    UPDATE public.bolsas_movimientos SET impreso_at = now() WHERE id = p_movimiento_id;
    RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marcar_vale_impreso(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_vale_impreso(bigint) TO authenticated, service_role;

-- ── Lo que hay que leer para pintar y para imprimir ─────────────────────────
--
-- El saldo y las salidas de cada bolsa, en una sola lectura: la etiqueta las
-- necesita para poder decir «efectivo que debe haber» y listarlas.
CREATE OR REPLACE FUNCTION public.get_bolsas_saldos(p_ids bigint[])
RETURNS TABLE (
    bolsa_id bigint, saldo numeric, salidas bigint, vales numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT b.id,
           public.bolsa_saldo(b.id),
           count(m.id) FILTER (WHERE m.monto < 0),
           coalesce(-sum(m.monto) FILTER (WHERE m.monto < 0), 0)
      FROM public.bolsas b
      LEFT JOIN public.bolsas_movimientos m
             ON m.bolsa_id = b.id AND m.anulado_at IS NULL
     WHERE b.id = ANY(p_ids)
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
     GROUP BY b.id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_bolsas_saldos(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bolsas_saldos(bigint[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_salidas_de_bolsa(p_bolsa_id bigint)
RETURNS TABLE (
    movimiento_id bigint, vale_folio text, monto numeric, registrado_at timestamptz,
    impreso_at timestamptz, anulado_at timestamptz,
    operacion_id bigint, operacion_folio text, tipo text, etiqueta text,
    monto_operacion numeric, entidad text, numero_boleta text, foto_url text, nota text,
    recibido_nombre text, recibido_metodo text, registrado_nombre text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT m.id, m.vale_folio, m.monto, m.registrado_at, m.impreso_at, m.anulado_at,
           o.id, o.folio, o.tipo, t.etiqueta, o.monto, o.entidad, o.numero_boleta,
           o.foto_url, o.nota, er.name, o.recibido_metodo, eq.name
      FROM public.bolsas_movimientos m
      JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
      JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
      LEFT JOIN public.employees er ON er.id = o.recibido_por
      LEFT JOIN public.employees eq ON eq.id = m.registrado_por
     WHERE m.bolsa_id = p_bolsa_id
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
     ORDER BY m.registrado_at;
$$;

REVOKE EXECUTE ON FUNCTION public.get_salidas_de_bolsa(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_salidas_de_bolsa(bigint) TO authenticated, service_role;
