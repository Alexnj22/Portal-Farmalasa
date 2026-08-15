-- Los avisos de las funciones de bolsas, escritos como habla el portal.
--
-- Salieron en VOSEO —«la entregaste vos», «mientras estabas en la pantalla»,
-- «Volve a abrirla»— que es exactamente el defecto que ya se corrigio una vez en
-- las funciones de cortes (migracion `20260814213451`). Vuelve a pasar por el
-- mismo motivo: **el gate de diseño no lee `supabase/`**, asi que hay texto de
-- interfaz viviendo dentro de funciones de Postgres que nada revisa.
--
-- Y llevan acentos: la regla de escribir sin tildes es del PAPEL —el rollo de la
-- ticketera es ASCII— no de la pantalla. Estos mensajes salen en un aviso del
-- navegador por `mensajeAmigable`.
--
-- Lo destapo la prueba de punta a punta en el entorno de pruebas: el aviso que
-- leyo la pantalla decia «La bolsa S3-1003 la entregaste vos».

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.recibir_bolsas(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo uuid := (SELECT auth_employee_id());
    v_n  integer := 0;
    r    record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    FOR r IN SELECT * FROM public.bolsas WHERE id = ANY(p_ids) FOR UPDATE LOOP
        IF r.estado <> 'ENTREGADA' THEN
            RAISE EXCEPTION 'La bolsa % no está esperando recepción.', r.folio;
        END IF;
        -- El control de fondo: dos confirmaciones firmadas por la misma persona
        -- no son un control, son dos clics.
        IF r.entregada_por IS NOT NULL AND r.entregada_por = v_yo THEN
            RAISE EXCEPTION 'La bolsa % la entregó la misma persona que intenta recibirla. La recepción la firma alguien más.', r.folio;
        END IF;

        UPDATE public.bolsas
           SET estado = 'RECIBIDA', recibida_por = v_yo, recibida_at = now(), updated_at = now()
         WHERE id = r.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id)
        VALUES (r.id, 'RECIBIR', r.estado, 'RECIBIDA', r.monto_inicial, v_yo);

        v_n := v_n + 1;
    END LOOP;

    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recibir_bolsas(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recibir_bolsas(bigint[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.entregar_bolsas(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo    uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia   bigint := (SELECT auth_employee_branch_id());
    v_n     integer := 0;
    r       record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    FOR r IN SELECT * FROM public.bolsas WHERE id = ANY(p_ids) FOR UPDATE LOOP
        IF v_scope IS DISTINCT FROM 'ALL' AND r.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salió de la sala.', r.folio;
        END IF;

        UPDATE public.bolsas
           SET estado = 'ENTREGADA', entregada_por = v_yo, entregada_at = now(), updated_at = now()
         WHERE id = r.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id)
        VALUES (r.id, 'ENTREGAR', r.estado, 'ENTREGADA', r.monto_inicial, v_yo);

        v_n := v_n + 1;
    END LOOP;

    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.entregar_bolsas(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entregar_bolsas(bigint[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contar_bolsa(
    p_id       bigint,
    p_contado  numeric,
    p_esperado numeric
)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_bolsa  public.bolsas;
    v_saldo  numeric;
    v_dif    numeric;
    v_yo     uuid := (SELECT auth_employee_id());
    v_sala   text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_contado IS NULL OR p_contado < 0 THEN
        RAISE EXCEPTION 'Hay que escribir cuánto se contó.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa no existe.'; END IF;

    IF v_bolsa.estado <> 'RECIBIDA' THEN
        RAISE EXCEPTION 'La bolsa % no está lista para contar.', v_bolsa.folio;
    END IF;

    -- El monto lo calcula el servidor: `p_esperado` es solo lo que la pantalla
    -- mostró, y si cambió en el medio hay que volver a mirarla.
    v_saldo := public.bolsa_saldo(p_id);
    IF round(coalesce(p_esperado, -1), 2) <> round(v_saldo, 2) THEN
        RAISE EXCEPTION 'Lo que debe haber cambió mientras la pantalla estaba abierta: ahora son % y en pantalla decía %. Hay que abrirla de nuevo.',
            to_char(v_saldo, 'FM999999990.00'),
            to_char(round(coalesce(p_esperado, 0), 2), 'FM999999990.00');
    END IF;

    v_dif := round(p_contado - v_saldo, 2);

    UPDATE public.bolsas
       SET estado      = 'CONTADA',
           contado     = round(p_contado, 2),
           contado_por = v_yo,
           contado_at  = now(),
           updated_at  = now()
     WHERE id = p_id
     RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    VALUES (p_id, 'CONTAR', 'RECIBIDA', 'CONTADA', v_dif, v_yo,
            CASE WHEN abs(v_dif) < 0.01 THEN 'Cuadró.' ELSE 'No cuadró.' END);

    -- Acá el monto SÍ va en el aviso: es un conteo firmado y ya no cambia, a
    -- diferencia de la cifra provisional de un corte recién capturado.
    IF abs(v_dif) >= 0.01 THEN
        SELECT name INTO v_sala FROM public.branches WHERE id = v_bolsa.branch_id;
        PERFORM public.notify_employees(
            public.destinatarios_de_modulo(v_bolsa.branch_id::integer, 'bolsas'),
            'bolsa_no_cuadra',
            CASE WHEN v_dif < 0 THEN 'Faltó dinero en una bolsa' ELSE 'Sobró dinero en una bolsa' END,
            format('%s · bolsa %s del corte del %s. Debía haber $%s y se contaron $%s.',
                   coalesce(v_sala, 'Sala'), v_bolsa.folio,
                   to_char(v_bolsa.fecha, 'DD/MM/YYYY'),
                   to_char(v_saldo, 'FM999,999,990.00'),
                   to_char(round(p_contado, 2), 'FM999,999,990.00')),
            '/cortes',
            jsonb_build_object('bolsa_id', p_id, 'folio', v_bolsa.folio, 'diferencia', v_dif),
            true,
            v_bolsa.branch_id::integer
        );
    END IF;

    RETURN v_bolsa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contar_bolsa(bigint, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contar_bolsa(bigint, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cerrar_bolsa_de_corte(
    p_corte_id       bigint,
    p_monto_esperado numeric
)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corte  public.cortes_caja;
    v_bolsa  public.bolsas;
    v_scope  text;
    v_monto  numeric;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El corte no existe.';
    END IF;

    v_scope := (SELECT auth_module_scope('bolsas'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del día no lleva bolsa.';
    END IF;

    IF v_corte.estado <> 'CONFIRMADO' THEN
        RAISE EXCEPTION 'Primero hay que confirmar el corte.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.bolsas b
                WHERE b.corte_id = p_corte_id AND b.estado <> 'ANULADA') THEN
        RAISE EXCEPTION 'Este corte ya tiene su bolsa.';
    END IF;

    v_monto := public.bolsa_sugerida(p_corte_id);

    IF v_monto IS NULL OR v_monto <= 0 THEN
        RAISE EXCEPTION 'No queda efectivo por guardar de este corte: las bolsas de la sala ya cubren lo declarado.';
    END IF;

    IF round(coalesce(p_monto_esperado, -1), 2) <> v_monto THEN
        RAISE EXCEPTION 'El monto cambió mientras la pantalla estaba abierta: ahora son % y en pantalla decía %. Hay que abrirla de nuevo.',
            to_char(v_monto, 'FM999999990.00'),
            to_char(round(coalesce(p_monto_esperado, 0), 2), 'FM999999990.00');
    END IF;

    INSERT INTO public.bolsas
        (folio, branch_id, corte_id, origen, monto_inicial, fecha, hora, caja, cerrada_por)
    VALUES
        (public.nuevo_folio_de_bolsa(v_corte.branch_id),
         v_corte.branch_id, p_corte_id, 'CORTE', v_monto,
         v_corte.fecha, v_corte.hora, v_corte.empleado_texto,
         (SELECT auth_employee_id()))
    RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_despues, monto, employee_id, nota)
    VALUES (v_bolsa.id, 'CREAR', 'ABIERTA', v_monto, (SELECT auth_employee_id()),
            'Se guardó a mano, sin corte recién confirmado.');

    RETURN v_bolsa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cerrar_bolsa_de_corte(bigint, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_bolsa_de_corte(bigint, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_bolsa(p_id bigint, p_motivo text)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_bolsa public.bolsas;
    v_scope text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular una bolsa exige decir por qué.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La bolsa no existe.';
    END IF;

    v_scope := (SELECT auth_module_scope('bolsas'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_bolsa.estado <> 'ABIERTA' THEN
        RAISE EXCEPTION 'Esta bolsa ya salió de la sala: no se puede anular.';
    END IF;

    UPDATE public.bolsas
       SET estado         = 'ANULADA',
           anulada_por    = (SELECT auth_employee_id()),
           anulada_motivo = btrim(p_motivo),
           anulada_at     = now(),
           updated_at     = now()
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

CREATE OR REPLACE FUNCTION public.resolver_diferencia_bolsa(
    p_id    bigint,
    p_via   text,
    p_causa text
)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_bolsa public.bolsas;
    v_yo    uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo','bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Vía inválida: %', p_via;
    END IF;
    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir por qué.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa no existe.'; END IF;

    IF v_bolsa.estado <> 'CONTADA' OR v_bolsa.contado IS NULL THEN
        RAISE EXCEPTION 'Esta bolsa todavía no se contó.';
    END IF;
    IF abs(round(v_bolsa.contado - public.bolsa_saldo(p_id), 2)) < 0.01 THEN
        RAISE EXCEPTION 'Esta bolsa cuadró: no hay nada que resolver.';
    END IF;

    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo']))
       AND v_scope IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.bolsas
       SET dif_via = p_via, dif_causa = btrim(p_causa), dif_por = v_yo, dif_at = now(),
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id)
    VALUES (p_id, 'RESOLVER', 'CONTADA', 'CONTADA', btrim(p_causa),
            round(v_bolsa.contado - public.bolsa_saldo(p_id), 2), v_yo);

    RETURN v_bolsa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolver_diferencia_bolsa(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_diferencia_bolsa(bigint, text, text) TO authenticated, service_role;