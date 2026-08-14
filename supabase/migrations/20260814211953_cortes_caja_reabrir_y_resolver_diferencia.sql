-- Cortes de caja: reabrir una firma y resolver la diferencia.
--
-- ── POR QUÉ EL MONTO NO VIAJA DESDE EL NAVEGADOR ───────────────────────────
-- La cifra que sale de acá es la que se le va a cobrar a alguien. Si el
-- navegador la mandara, cualquiera con la consola abierta elige cuánto repone.
-- Así que el servidor la calcula (`corte_tramo`) y el llamador sólo manda la que
-- VIO en pantalla: si no coinciden, la operación se rechaza en vez de guardar en
-- silencio un número que nadie leyó. Ver `rpc_authorship_never_trust_client_param`.
--
-- `corte_diferencia` es la traducción de `diferenciaDelCorte()` de
-- `src/utils/cortesDiagnostico.js`, y `corte_tramo` la de `conTramo()`.
-- ⚠️ Son DOS implementaciones de la misma regla: al tocar una hay que tocar la
-- otra. El chequeo de `p_monto_esperado` es justamente lo que convierte una
-- divergencia futura en un error visible y no en un cobro equivocado.
-- Verificadas contra las dos: reproducen el mismo valor en los 35 cortes
-- capturados al 2026-08-14.

SET lock_timeout = '5s';

-- ── La diferencia propia de un corte ───────────────────────────────────────
-- El origen produce dos cifras y manda la del ticket, salvo cuando el ticket
-- sumó cobros de crédito que al momento del corte no habían entrado (brecha de
-- exactamente +1×), donde manda la guardada.
CREATE OR REPLACE FUNCTION public.corte_diferencia(
    p_declarado numeric, p_dif_erp numeric, p_total_caja numeric, p_cobros numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT CASE
        WHEN p_declarado IS NULL OR p_dif_erp IS NULL OR p_total_caja IS NULL
            THEN coalesce(p_dif_erp, 0)
        WHEN p_cobros IS NOT NULL AND abs(p_cobros) >= 0.01
             AND abs(((p_dif_erp - (p_declarado - p_total_caja)) / p_cobros)
                     - round((p_dif_erp - (p_declarado - p_total_caja)) / p_cobros)) < 0.001
             AND round((p_dif_erp - (p_declarado - p_total_caja)) / p_cobros) = 1
            THEN round(p_dif_erp, 2)
        ELSE round(p_declarado - p_total_caja, 2)
    END;
$$;

-- ── El tramo: contra el último CONFIRMADO de esa sala en ese día ────────────
-- Sólo una decisión firmada corre la base (regla del usuario, 2026-08-14). Ver
-- el bloque largo de `conTramo()`.
CREATE OR REPLACE FUNCTION public.corte_tramo(p_corte_id bigint)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v      public.cortes_caja;
    v_dif  numeric;
    v_base numeric;
BEGIN
    SELECT * INTO v FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
    IF v.tipo <> 'C' THEN RAISE EXCEPTION 'El cierre del dia no tiene tramo.'; END IF;

    v_dif := public.corte_diferencia(v.total_declarado, v.diferencia_erp,
                                     v.tk_total_caja, v.tk_cobros_credito);

    SELECT public.corte_diferencia(c2.total_declarado, c2.diferencia_erp,
                                   c2.tk_total_caja, c2.tk_cobros_credito)
      INTO v_base
      FROM public.cortes_caja c2
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND c2.estado    = 'CONFIRMADO'
       AND c2.hora      < v.hora
     ORDER BY c2.hora DESC
     LIMIT 1;

    RETURN round(v_dif - coalesce(v_base, 0), 2);
END;
$$;

-- ── Reabrir una firma ──────────────────────────────────────────────────────
-- «Se debe poder editar, aun confirmado, queda el registro de quién y por qué»
-- (usuario, 2026-08-14), y lo puede hacer la propia sala. Lo que hace segura la
-- reapertura es la bitácora: `resuelto_por`/`resuelto_at` guardan sólo la última
-- decisión, así que sin el evento la firma anterior desaparecería sin rastro.
CREATE OR REPLACE FUNCTION public.reabrir_corte_caja(p_id bigint, p_motivo text)
RETURNS public.cortes_caja
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corte public.cortes_caja;
    v_scope text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Reabrir un corte exige decir por que.';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.estado = 'PENDIENTE' THEN
        RAISE EXCEPTION 'Este corte ya esta abierto.';
    END IF;

    -- Primero la diferencia. Reabrir puede mover el tramo —la base sale del
    -- último confirmado— y entonces el monto que alguien ya repuso dejaria de
    -- corresponderse con el corte. Se anula a mano, que obliga a mirarlo.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.corte_id = p_id AND d.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este corte tiene una diferencia resuelta. Anulala antes de reabrirlo.';
    END IF;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, estado_antes, estado_despues, motivo, employee_id)
    VALUES (p_id, 'REABRIR', v_corte.estado, 'PENDIENTE', btrim(p_motivo),
            (SELECT auth_employee_id()));

    UPDATE public.cortes_caja SET
        estado          = 'PENDIENTE',
        motivo_descarte = NULL,
        resuelto_por    = NULL,
        resuelto_at     = NULL,
        updated_at      = now()
    WHERE id = p_id
    RETURNING * INTO v_corte;

    RETURN v_corte;
END;
$$;

-- ── Firmar, ahora dejando rastro ───────────────────────────────────────────
-- Mismo cuerpo que antes más el evento. La firma vieja ya no es la única copia
-- de la decisión, que es lo que permite reabrir sin perder historia.
CREATE OR REPLACE FUNCTION public.resolver_corte_caja(
    p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text,
    p_observaciones text DEFAULT NULL::text)
RETURNS public.cortes_caja
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corte public.cortes_caja;
    v_scope text;
    v_antes text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_estado NOT IN ('CONFIRMADO','DESCARTADO') THEN
        RAISE EXCEPTION 'Estado invalido: %', p_estado;
    END IF;

    IF p_estado = 'DESCARTADO' AND (p_motivo IS NULL OR btrim(p_motivo) = '') THEN
        RAISE EXCEPTION 'Descartar un corte exige decir por que.';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El corte no existe.';
    END IF;

    -- Quien ve solo su sala no resuelve la de otra. Se chequea aca porque la
    -- funcion es DEFINER y por lo tanto no pasa por la policy de la tabla.
    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- El Z es el cierre del dia, no un conteo: no se confirma ni se descarta.
    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no se confirma.';
    END IF;

    -- Un corte resuelto no se repisa: para cambiar la decision hay que reabrirlo
    -- con `reabrir_corte_caja`, que exige motivo y lo deja en la bitacora.
    IF v_corte.estado <> 'PENDIENTE' THEN
        RAISE EXCEPTION 'Este corte ya fue resuelto. Reabrilo para cambiar la decision.';
    END IF;

    v_antes := v_corte.estado;

    UPDATE public.cortes_caja SET
        estado          = p_estado,
        motivo_descarte = CASE WHEN p_estado = 'DESCARTADO' THEN btrim(p_motivo) END,
        observaciones   = NULLIF(btrim(coalesce(p_observaciones,'')), ''),
        resuelto_por    = (SELECT auth_employee_id()),
        resuelto_at     = now(),
        updated_at      = now()
    WHERE id = p_id
    RETURNING * INTO v_corte;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, estado_antes, estado_despues, motivo, nota, employee_id)
    VALUES (p_id,
            CASE WHEN p_estado = 'CONFIRMADO' THEN 'CONFIRMAR' ELSE 'DESCARTAR' END,
            v_antes, p_estado,
            CASE WHEN p_estado = 'DESCARTADO' THEN btrim(p_motivo) END,
            NULLIF(btrim(coalesce(p_observaciones,'')), ''),
            (SELECT auth_employee_id()));

    RETURN v_corte;
END;
$$;

-- ── Resolver la diferencia ─────────────────────────────────────────────────
-- `p_personas`: [{"employee_id":"uuid","monto":1.25,"del_turno":true}, ...]
-- Sólo para REPONE — un sobrante que se retira o que se justifica no lo aporta
-- nadie. La suma tiene que dar el monto exacto: repartir mal deja a alguien
-- debiendo un centavo que no aparece en ningún lado.
CREATE OR REPLACE FUNCTION public.resolver_diferencia_corte(
    p_corte_id       bigint,
    p_via            text,
    p_causa          text,
    p_monto_esperado numeric,
    p_personas       jsonb DEFAULT '[]'::jsonb)
RETURNS public.cortes_caja_diferencias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corte  public.cortes_caja;
    v_scope  text;
    v_monto  numeric;
    v_dif    public.cortes_caja_diferencias;
    v_suma   numeric;
    v_cuenta integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Via invalida: %', p_via;
    END IF;

    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir la causa.';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no tiene diferencia que resolver.';
    END IF;

    IF v_corte.estado = 'DESCARTADO' THEN
        RAISE EXCEPTION 'Un corte descartado no tiene diferencia que reponer.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    -- El monto lo pone el servidor. Ver el encabezado.
    v_monto := public.corte_tramo(p_corte_id);

    IF abs(v_monto) < 0.01 THEN
        RAISE EXCEPTION 'Este corte cuadra: no hay diferencia que resolver.';
    END IF;

    IF p_monto_esperado IS NULL OR abs(v_monto - p_monto_esperado) >= 0.01 THEN
        RAISE EXCEPTION 'La diferencia cambio mientras resolvias: ahora es %, no %. Volve a abrirla.',
            to_char(v_monto, 'FM999999990.00'), to_char(coalesce(p_monto_esperado, 0), 'FM999999990.00');
    END IF;

    IF p_via = 'REPONE' AND v_monto > 0 THEN
        RAISE EXCEPTION 'Este corte tiene sobrante: no hay nada que reponer.';
    END IF;
    IF p_via = 'RETIRA' AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: no hay nada que retirar.';
    END IF;

    SELECT count(*), coalesce(sum((x->>'monto')::numeric), 0)
      INTO v_cuenta, v_suma
      FROM jsonb_array_elements(coalesce(p_personas, '[]'::jsonb)) x;

    IF p_via = 'REPONE' THEN
        IF v_cuenta = 0 THEN
            RAISE EXCEPTION 'Decinos quien repone el dinero.';
        END IF;
        IF abs(v_suma - abs(v_monto)) >= 0.01 THEN
            RAISE EXCEPTION 'Lo que aportan suma % y el faltante es %.',
                to_char(v_suma, 'FM999999990.00'), to_char(abs(v_monto), 'FM999999990.00');
        END IF;
    ELSIF v_cuenta > 0 THEN
        RAISE EXCEPTION 'Solo una reposicion lleva personas que aportan.';
    END IF;

    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por)
    VALUES (p_corte_id, v_corte.branch_id, v_corte.fecha, v_monto, p_via,
            btrim(p_causa), (SELECT auth_employee_id()))
    RETURNING * INTO v_dif;

    IF v_cuenta > 0 THEN
        INSERT INTO public.cortes_caja_diferencia_personas
            (diferencia_id, employee_id, monto, del_turno)
        SELECT v_dif.id, (x->>'employee_id')::uuid, (x->>'monto')::numeric,
               coalesce((x->>'del_turno')::boolean, false)
          FROM jsonb_array_elements(p_personas) x;
    END IF;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (p_corte_id, 'RESOLVER_DIFERENCIA', btrim(p_causa),
            p_via || ' ' || to_char(v_monto, 'FM999999990.00'),
            (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$$;

-- ── Permisos ───────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.corte_diferencia(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.corte_tramo(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reabrir_corte_caja(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.corte_diferencia(numeric, numeric, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.corte_tramo(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reabrir_corte_caja(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb) TO authenticated, service_role;
