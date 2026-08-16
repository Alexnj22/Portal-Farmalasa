-- La entrega del efectivo a quien se lo lleva (2026-08-16).
--
-- Pedido del usuario: «el dependiente de la sala abre el módulo, marca entregar
-- dinero, selecciona los días, y confirma; al confirmar pide que se escanee el
-- carné (o poner usuario y contraseña) y queda registrado quién lo recibió. Al
-- llegar a admin, alguien de admin confirma de recibido, y ahí queda finalizado
-- el traslado de dinero. Y queda abierto el conteo.»
--
-- Los cuatro carriles de la pantalla ya eran ésos. Faltaban tres cosas:
--
-- 1. **Nadie probaba quién se llevaba el dinero.** `entregar_bolsas` guardaba
--    `entregada_por` —la sesión de la sala— y nada más. El momento de mayor
--    riesgo del circuito (el efectivo sale de la sala y todavía no llegó a
--    administración) era el único sin identidad.
-- 2. **La entrega no existía como hecho.** Eran N bolsas marcadas sueltas, así
--    que no había a qué ponerle folio, ni qué firmar, ni qué confirmar de
--    recibido como una sola cosa.
-- 3. El comprobante que firman los dos estaba escrito desde el 15-ago
--    (`construirComprobanteDeEntrega`) y no tenía de dónde salir.
SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS public.bolsas_entrega_folio_seq START 1000;

CREATE TABLE IF NOT EXISTS public.bolsas_entregas (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio           text NOT NULL UNIQUE,
    branch_id       bigint NOT NULL REFERENCES public.branches(id),
    -- Quien la despacha desde la sala: la sesión que aprieta el botón.
    entregada_por   uuid REFERENCES public.employees(id),
    entregada_at    timestamptz NOT NULL DEFAULT now(),
    -- Quien SE LLEVA el efectivo, probado con carné o con usuario y contraseña.
    -- No es texto tecleado: es un empleado resuelto contra su credencial.
    recibido_por    uuid NOT NULL REFERENCES public.employees(id),
    recibido_metodo text NOT NULL CHECK (recibido_metodo IN ('CARNE','CLAVE')),
    -- Administración acusa recibo. Hasta que esto se llena, el dinero está en
    -- tránsito: ni en la sala ni en administración.
    confirmada_por  uuid REFERENCES public.employees(id),
    confirmada_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bolsas_entregas_sala ON public.bolsas_entregas(branch_id, entregada_at DESC);
CREATE INDEX IF NOT EXISTS idx_bolsas_entregas_recibido ON public.bolsas_entregas(recibido_por);
CREATE INDEX IF NOT EXISTS idx_bolsas_entregas_abiertas ON public.bolsas_entregas(confirmada_at) WHERE confirmada_at IS NULL;

ALTER TABLE public.bolsas ADD COLUMN IF NOT EXISTS entrega_id bigint REFERENCES public.bolsas_entregas(id);
CREATE INDEX IF NOT EXISTS idx_bolsas_entrega ON public.bolsas(entrega_id);

ALTER TABLE public.bolsas_entregas ENABLE ROW LEVEL SECURITY;

-- Sin policy de escritura, como el resto del circuito: escribe sólo la función
-- DEFINER. Es lo que impide que el navegador elija quién recibió el dinero.
DROP POLICY IF EXISTS bolsas_entregas_select ON public.bolsas_entregas;
CREATE POLICY bolsas_entregas_select ON public.bolsas_entregas
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('bolsas','can_view'))
           AND (((SELECT auth_module_scope('bolsas')) = 'ALL')
                OR branch_id = (SELECT auth_employee_branch_id())));

DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_entregas;
CREATE POLICY bloqueo_global ON public.bolsas_entregas
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth_no_bloqueado()));

REVOKE ALL ON public.bolsas_entregas FROM anon;
GRANT SELECT ON public.bolsas_entregas TO authenticated;

-- ── El vale de identidad se consume en UN solo sitio ────────────────────────
--
-- Lo usan la remesa y la entrega. Escrito dos veces, la próxima corrección
-- —cuánto vive, si se puede reusar— arreglaría una sola de las dos.
CREATE OR REPLACE FUNCTION public.consumir_vale_de_identidad(p_vale uuid, p_persona uuid)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.identidad_vales;
BEGIN
    IF p_vale IS NULL THEN
        RAISE EXCEPTION 'Falta comprobar la identidad de quien se lleva el efectivo.';
    END IF;

    -- FOR UPDATE y marcado en la misma transacción: dos pestañas abiertas no
    -- pueden gastar el mismo vale dos veces.
    SELECT * INTO v FROM public.identidad_vales WHERE token = p_vale FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
    IF v.usado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa comprobacion ya se uso. Hay que hacerla de nuevo.'; END IF;
    IF v.created_at < now() - interval '5 minutes' THEN
        RAISE EXCEPTION 'La comprobacion de identidad vencio. Hay que hacerla de nuevo.'; END IF;
    IF v.employee_id IS DISTINCT FROM p_persona THEN
        RAISE EXCEPTION 'La identidad comprobada no es la de quien figura llevandose el efectivo.'; END IF;

    UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    RETURN v.metodo;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.consumir_vale_de_identidad(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consumir_vale_de_identidad(uuid, uuid) TO service_role;

-- ── Entregar: la sala despacha, y queda probado quién se lo lleva ───────────
DROP FUNCTION IF EXISTS public.entregar_bolsas(bigint[]);

CREATE OR REPLACE FUNCTION public.entregar_bolsas(
    p_ids bigint[], p_recibido_por uuid, p_vale uuid)
 RETURNS bolsas_entregas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_scope  text := (SELECT auth_module_scope('bolsas'));
    v_mia    bigint := (SELECT auth_employee_branch_id());
    v_branch bigint;
    v_metodo text;
    v_codigo text;
    v_ent    public.bolsas_entregas;
    v_n      integer := 0;
    r        record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Hay que elegir al menos una bolsa.';
    END IF;
    IF p_recibido_por IS NULL THEN
        RAISE EXCEPTION 'Falta quien se lleva el efectivo.';
    END IF;

    -- Primero las bolsas y después la identidad: si algo de las bolsas no
    -- cuadra, el vale no se gasta y no hay que volver a escanear el carne.
    FOR r IN SELECT * FROM public.bolsas WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE LOOP
        IF v_scope IS DISTINCT FROM 'ALL' AND r.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salio de la sala.', r.folio;
        END IF;
        IF v_branch IS NULL THEN v_branch := r.branch_id;
        ELSIF v_branch <> r.branch_id THEN
            RAISE EXCEPTION 'Una entrega es de UNA sala: no se pueden juntar bolsas de dos sucursales.';
        END IF;
        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN RAISE EXCEPTION 'Ninguna de esas bolsas existe.'; END IF;
    IF v_n <> array_length(p_ids, 1) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya no esta. Hay que cargar la lista de nuevo.';
    END IF;

    -- Quien se lleva el dinero tiene que estar activo. No se exige que sea de
    -- ESA sala: justamente suele ser alguien de administracion que recolecta.
    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_recibido_por AND e.status = 'ACTIVO') THEN
        RAISE EXCEPTION 'Esa persona no esta activa: no puede recibir efectivo.';
    END IF;

    v_metodo := public.consumir_vale_de_identidad(p_vale, p_recibido_por);

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo
      FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_entregas
        (folio, branch_id, entregada_por, recibido_por, recibido_metodo)
    VALUES ('E-' || v_codigo || '-' || nextval('public.bolsas_entrega_folio_seq'),
            v_branch, v_yo, p_recibido_por, v_metodo)
    RETURNING * INTO v_ent;

    UPDATE public.bolsas
       SET estado = 'ENTREGADA', entregada_por = v_yo, entregada_at = now(),
           entrega_id = v_ent.id, updated_at = now()
     WHERE id = ANY(p_ids);

    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'ENTREGAR', 'ABIERTA', 'ENTREGADA', b.monto_inicial, v_yo,
           format('%s · se lo lleva %s (%s)', v_ent.folio,
                  coalesce((SELECT e.name FROM public.employees e WHERE e.id = p_recibido_por), 'sin nombre'),
                  CASE WHEN v_metodo = 'CARNE' THEN 'carne' ELSE 'usuario y contrasena' END)
      FROM public.bolsas b WHERE b.id = ANY(p_ids);

    RETURN v_ent;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.entregar_bolsas(bigint[], uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.entregar_bolsas(bigint[], uuid, uuid) TO authenticated, service_role;

-- ── Recibir: administración cierra el traslado y se abre el conteo ─────────
CREATE OR REPLACE FUNCTION public.recibir_bolsas(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo uuid := (SELECT auth_employee_id());
    v_n  integer := 0;
    r    record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    FOR r IN SELECT * FROM public.bolsas WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE LOOP
        IF r.estado <> 'ENTREGADA' THEN
            RAISE EXCEPTION 'La bolsa % no esta esperando recepcion.', r.folio;
        END IF;
        -- El control de fondo: dos confirmaciones firmadas por la misma persona
        -- no son un control, son dos clics.
        IF r.entregada_por IS NOT NULL AND r.entregada_por = v_yo THEN
            RAISE EXCEPTION 'La bolsa % la entrego la misma persona que intenta recibirla. La recepcion la firma alguien mas.', r.folio;
        END IF;

        UPDATE public.bolsas
           SET estado = 'RECIBIDA', recibida_por = v_yo, recibida_at = now(), updated_at = now()
         WHERE id = r.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id)
        VALUES (r.id, 'RECIBIR', r.estado, 'RECIBIDA', r.monto_inicial, v_yo);

        v_n := v_n + 1;
    END LOOP;

    -- Una entrega queda finalizada cuando ninguna de sus bolsas sigue en
    -- camino. Se cierra acá y no en el llamador para que «el traslado terminó»
    -- sea un hecho de la base y no una cuenta que hace la pantalla.
    UPDATE public.bolsas_entregas en
       SET confirmada_por = v_yo, confirmada_at = now()
     WHERE en.confirmada_at IS NULL
       AND EXISTS (SELECT 1 FROM public.bolsas b WHERE b.entrega_id = en.id AND b.id = ANY(p_ids))
       AND NOT EXISTS (SELECT 1 FROM public.bolsas b
                        WHERE b.entrega_id = en.id AND b.estado = 'ENTREGADA');

    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recibir_bolsas(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recibir_bolsas(bigint[]) TO authenticated, service_role;

-- ── Lo que necesita el comprobante que firman los dos ──────────────────────
CREATE OR REPLACE FUNCTION public.get_entrega(p_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT json_build_object(
        'entrega', to_json(en),
        'sala',    (SELECT br.name FROM public.branches br WHERE br.id = en.branch_id),
        'entregado_por', (SELECT e.name FROM public.employees e WHERE e.id = en.entregada_por),
        'recibido_por',  (SELECT e.name FROM public.employees e WHERE e.id = en.recibido_por),
        'bolsas', coalesce((
            SELECT json_agg(json_build_object(
                'folio', b.folio, 'fecha', b.fecha, 'hora', b.hora,
                'efectivo', public.bolsa_saldo(b.id),
                'vales', round(b.monto_inicial - public.bolsa_saldo(b.id), 2)
            ) ORDER BY b.fecha, b.hora)
            FROM public.bolsas b WHERE b.entrega_id = en.id
        ), '[]'::json)
    )
    FROM public.bolsas_entregas en
    WHERE en.id = p_id
      AND (SELECT auth_has_module_permission('bolsas','can_view'))
      AND (((SELECT auth_module_scope('bolsas')) = 'ALL')
           OR en.branch_id = (SELECT auth_employee_branch_id()));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_entrega(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_entrega(bigint) TO authenticated, service_role;

COMMENT ON TABLE public.bolsas_entregas IS
 'Una entrega de efectivo de la sala a quien lo recolecta: varias bolsas, un folio, y la identidad PROBADA de quien se lo lleva. Se cierra cuando administracion acusa recibo de todas sus bolsas.';
