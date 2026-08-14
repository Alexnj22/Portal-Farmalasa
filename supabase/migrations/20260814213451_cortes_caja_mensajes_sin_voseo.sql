-- Los mensajes de estas funciones SALEN A PANTALLA: el navegador los muestra tal
-- cual por `mensajeAmigable`, porque dicen exactamente qué pasó y taparlos con
-- uno genérico perdería la única explicación útil.
--
-- Estaban en voseo, y el portal usa tuteo (DESIGN.md §26.7). `gate:design` NO
-- los vio: sólo lee `src/`, así que la categoría `copy-trato` tiene un punto
-- ciego en `supabase/` — hay texto de interfaz viviendo dentro de funciones de
-- Postgres. Es la misma trampa de la regla «un rótulo no es una clave»: el
-- chequeo mira donde cree que vive el texto, no donde vive.
--
-- Se redactaron en IMPERSONAL («hay que anularla») en vez de tuteo («anúlala»)
-- a propósito: así no hay que elegir entre poner acentos —que el resto de estas
-- funciones no usa— o escribir un imperativo que sin acento vuelve a leerse como
-- voseo. Cambia sólo el texto; la lógica es idéntica.

SET lock_timeout = '5s';

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
        RAISE EXCEPTION 'Este corte tiene una diferencia resuelta. Hay que anularla antes de reabrirlo.';
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
        RAISE EXCEPTION 'Este corte ya fue resuelto. Hay que reabrirlo para cambiar la decision.';
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

    -- El monto lo pone el servidor. Ver el encabezado de 20260814211953.
    v_monto := public.corte_tramo(p_corte_id);

    IF abs(v_monto) < 0.01 THEN
        RAISE EXCEPTION 'Este corte cuadra: no hay diferencia que resolver.';
    END IF;

    IF p_monto_esperado IS NULL OR abs(v_monto - p_monto_esperado) >= 0.01 THEN
        RAISE EXCEPTION 'La diferencia cambio mientras se resolvia: ahora es %, no %. Hay que abrirla de nuevo.',
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
            RAISE EXCEPTION 'Falta decir quien repone el dinero.';
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

CREATE OR REPLACE FUNCTION public.asentar_diferencias_corte(p_ids bigint[], p_ref text)
RETURNS SETOF public.cortes_caja_diferencias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_signos integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'No hay nada que registrar.';
    END IF;
    IF p_ref IS NULL OR btrim(p_ref) = '' THEN
        RAISE EXCEPTION 'Falta el numero con que quedo el ingreso o el vale.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.cortes_caja_diferencias d
         WHERE d.id = ANY(p_ids)
           AND (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
           AND d.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id())
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(p_ids) AND (d.anulada_at IS NOT NULL OR d.asentado_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Alguna ya estaba registrada o anulada. Hay que cargar la lista de nuevo.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(p_ids) AND d.via = 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Una diferencia justificada no mueve dinero: no va en el ingreso.';
    END IF;

    SELECT count(DISTINCT sign(d.monto)) INTO v_signos
      FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);
    IF v_signos > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar faltantes y sobrantes: son dos documentos distintos.';
    END IF;

    UPDATE public.cortes_caja_diferencias d SET
        asentado_at = now(), asentado_por = (SELECT auth_employee_id()),
        asentado_ref = btrim(p_ref), updated_at = now()
    WHERE d.id = ANY(p_ids);

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    SELECT d.corte_id, 'ASENTAR', btrim(p_ref), (SELECT auth_employee_id())
      FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);

    RETURN QUERY
    SELECT d.* FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);
END;
$$;
