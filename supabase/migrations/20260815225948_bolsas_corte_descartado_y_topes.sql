-- Tres agujeros que encontró la segunda auditoría, medidos en staging antes de
-- corregirlos. Los tres son de OMISIÓN: nada fallaba, simplemente no había nada
-- que impidiera el caso.
--
-- ── 1. El corte se descarta y la bolsa queda huérfana ───────────────────────
--
-- Y no es un caso raro: **el sistema de origen no anula cortes, la sala los
-- REHACE** cuando encuentra un error (está medido en el módulo de cortes). O sea
-- que va a pasar seguido: se confirma un corte, nace su bolsa, se descubre el
-- error, se descarta el corte y se rehace. Medido antes: la bolsa seguía en
-- ABIERTA y nada la marcaba.
--
-- Ahora un disparador la anula sola — pero SÓLO si está limpia. Si ya le sacaron
-- dinero, el efectivo se movió de verdad y anularla en silencio borraría el
-- respaldo de esa salida: ahí deja el hecho en la bitácora y le avisa a la sala
-- para que alguien lo mire.
--
-- ── 2. Anular una bolsa dejaba sus vales vivos ──────────────────────────────
--
-- Medido: una bolsa anulada con un vale de 200 adentro quedaba con saldo 300 y
-- el vale seguía vigente, respaldando una bolsa que ya no cuenta. Ahora se
-- rechaza con un mensaje que dice qué hacer.
--
-- ── 3. Un reintegro no tenía tope ───────────────────────────────────────────
--
-- Medido: metí 99,999 en una bolsa de 500 y el saldo quedó en 100,299. El tope
-- natural es lo que salió: una bolsa no puede tener más de lo que se guardó.

SET lock_timeout = '5s';

-- ── Anular exige que no queden vales adentro ────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_bolsa(p_id bigint, p_motivo text)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_bolsa public.bolsas;
    v_scope text;
    v_vales integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular una bolsa exige decir por qué.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('bolsas'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_bolsa.estado <> 'ABIERTA' THEN
        RAISE EXCEPTION 'Esta bolsa ya salió de la sala: no se puede anular.';
    END IF;

    SELECT count(*) INTO v_vales FROM public.bolsas_movimientos m
     WHERE m.bolsa_id = p_id AND m.anulado_at IS NULL;
    IF v_vales > 0 THEN
        RAISE EXCEPTION 'Esta bolsa tiene % % adentro. Hay que anularlos primero: si no, quedan respaldando una bolsa que ya no cuenta.',
            v_vales, CASE WHEN v_vales = 1 THEN 'vale' ELSE 'vales' END;
    END IF;

    UPDATE public.bolsas
       SET estado = 'ANULADA', anulada_por = (SELECT auth_employee_id()),
           anulada_motivo = btrim(p_motivo), anulada_at = now(), updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id)
    VALUES (p_id, 'ANULAR', 'ABIERTA', 'ANULADA', btrim(p_motivo), v_bolsa.monto_inicial,
            (SELECT auth_employee_id()));

    RETURN v_bolsa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anular_bolsa(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_bolsa(bigint, text) TO authenticated, service_role;

-- ── La bolsa de un corte descartado ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bolsa_al_descartar_corte()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    b      public.bolsas;
    v_n    integer;
    v_sala text;
BEGIN
    SELECT * INTO b FROM public.bolsas
     WHERE corte_id = NEW.id AND estado <> 'ANULADA' FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT count(*) INTO v_n FROM public.bolsas_movimientos m
     WHERE m.bolsa_id = b.id AND m.anulado_at IS NULL;

    -- Limpia y todavía en la sala: se anula sola. El dinero no se movió y el
    -- corte que la justificaba dejó de existir.
    IF b.estado = 'ABIERTA' AND v_n = 0 THEN
        UPDATE public.bolsas
           SET estado = 'ANULADA', anulada_motivo = 'El corte se descartó.',
               anulada_at = now(), updated_at = now()
         WHERE id = b.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id)
        VALUES (b.id, 'ANULAR', b.estado, 'ANULADA', 'El corte se descartó.',
                b.monto_inicial, NEW.resuelto_por);
        RETURN NEW;
    END IF;

    -- Con vales adentro o ya fuera de la sala, NO se toca: anularla en silencio
    -- borraría el respaldo de un dinero que se movió de verdad. Queda el hecho y
    -- alguien lo mira.
    INSERT INTO public.bolsas_eventos (bolsa_id, accion, motivo, monto, employee_id, nota)
    VALUES (b.id, 'CORTE_DESCARTADO', 'El corte que la originó se descartó.',
            b.monto_inicial, NEW.resuelto_por,
            CASE WHEN v_n > 0 THEN 'Tiene vales adentro: hay que revisarla a mano.'
                 ELSE 'Ya salió de la sala: se revisa en el conteo.' END);

    SELECT name INTO v_sala FROM public.branches WHERE id = b.branch_id;
    PERFORM public.notify_employees(
        public.destinatarios_de_modulo(b.branch_id::integer, 'bolsas'),
        'bolsa_de_corte_descartado',
        'Una bolsa quedó de un corte descartado',
        format('%s · la bolsa %s por $%s viene de un corte que se descartó. Hay que revisarla a mano.',
               coalesce(v_sala, 'Sala'), b.folio, to_char(b.monto_inicial, 'FM999,999,990.00')),
        '/cortes',
        jsonb_build_object('bolsa_id', b.id, 'folio', b.folio, 'corte_id', NEW.id),
        true,
        b.branch_id::integer
    );

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bolsa_al_descartar_corte() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bolsa_al_descartar_corte ON public.cortes_caja;
CREATE TRIGGER trg_bolsa_al_descartar_corte
    AFTER UPDATE ON public.cortes_caja
    FOR EACH ROW
    WHEN (NEW.estado = 'DESCARTADO' AND OLD.estado IS DISTINCT FROM 'DESCARTADO')
    EXECUTE FUNCTION public.bolsa_al_descartar_corte();

-- ── Cuánto se le puede devolver a una bolsa ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.bolsa_reintegro_maximo(p_bolsa_id bigint)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT greatest(0, round(b.monto_inicial - public.bolsa_saldo(b.id), 2))
      FROM public.bolsas b WHERE b.id = p_bolsa_id;
$$;

REVOKE EXECUTE ON FUNCTION public.bolsa_reintegro_maximo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolsa_reintegro_maximo(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(
    p_tipo text, p_monto numeric, p_repartos jsonb,
    p_entidad text DEFAULT NULL, p_numero_boleta text DEFAULT NULL, p_foto_url text DEFAULT NULL,
    p_nota text DEFAULT NULL, p_recibido_por uuid DEFAULT NULL, p_metodo text DEFAULT NULL,
    p_secreto text DEFAULT NULL)
RETURNS public.bolsas_operaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    t public.bolsas_tipos_salida; v_oper public.bolsas_operaciones;
    v_yo uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia bigint := (SELECT auth_employee_branch_id());
    v_branch bigint; v_suma numeric := 0; v_codigo text; r record; b public.bolsas;
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
        IF p_metodo IS NULL OR p_metodo NOT IN ('CARNE','CLAVE') THEN
            RAISE EXCEPTION 'Quien retira el efectivo se identifica con su carné o con su usuario y contraseña.'; END IF;
        IF NOT public.verificar_persona(p_recibido_por, p_metodo, p_secreto) THEN
            RAISE EXCEPTION 'No se pudo comprobar la identidad de quien retira el efectivo.'; END IF;
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
         CASE WHEN t.pide_receptor THEN p_metodo END, v_yo)
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
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, text) TO authenticated, service_role;
