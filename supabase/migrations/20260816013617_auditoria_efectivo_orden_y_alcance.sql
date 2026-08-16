-- Auditoría del circuito del efectivo (2026-08-15) — hallazgos 2, 3, 7 y 8.
--
-- Los cinco arreglos comparten una raíz: el tramo y el monto de la bolsa son
-- valores DERIVADOS de qué cortes están confirmados, y hasta hoy nada impedía
-- que ese estado cambiara por debajo de una cifra ya firmada.
SET lock_timeout = '5s';

-- ── 2. La bolsa resta TODO lo ya embolsado del día, no sólo lo anterior ─────
--
-- `b.hora < c.hora` daba por sentado que los cortes se confirman en orden. No
-- hay nada que lo obligue: la campana, la baldosa y el módulo ofrecen los
-- pendientes en cualquier secuencia. Confirmando el de las 21:03 y después el
-- de las 12:39, la bolsa del segundo no veía a la del primero y la sala recibía
-- una etiqueta por dinero que ya estaba adentro de la otra bolsa.
--
-- Medido en Salud 3 del 13-ago: en orden da 1,027.17 (correcto); al revés daba
-- 1,515.97, o sea $488.80 de efectivo fantasma.
--
-- Sin el filtro de hora el resultado es el mismo en orden cronológico y correcto
-- en cualquier otro: lo que entra a la bolsa es lo declarado menos lo que ya se
-- guardó, sin importar cuándo se guardó. Un negativo significa «esto ya está en
-- otra bolsa» y quien llama lo trata como «no hay nada que guardar».
CREATE OR REPLACE FUNCTION public.bolsa_sugerida(p_corte_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT round(c.total_declarado - coalesce((
        SELECT sum(b.monto_inicial)
          FROM public.bolsas b
         WHERE b.branch_id = c.branch_id
           AND b.fecha     = c.fecha
           AND b.estado   <> 'ANULADA'
    ), 0), 2)
      FROM public.cortes_caja c
     WHERE c.id = p_corte_id;
$function$;

-- ── 8d. El desempate de hora ────────────────────────────────────────────────
--
-- `hora <` deja sin base a un corte que empata con el anterior. Hoy no hay
-- empates, pero el sistema de origen no anula cortes: los REHACE, a veces
-- dentro del mismo minuto. Un empate haría desaparecer la base en silencio y el
-- tramo saldría igual al acumulado del día. El desempate por `id` es
-- determinista y coincide con el orden en que se capturaron.
CREATE OR REPLACE FUNCTION public.corte_tramo(p_corte_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
       AND (c2.hora, c2.id) < (v.hora, v.id)
     ORDER BY c2.hora DESC, c2.id DESC
     LIMIT 1;

    RETURN round(v_dif - coalesce(v_base, 0), 2);
END;
$function$;

-- ── 3. Nadie mueve la base de una diferencia ya firmada ─────────────────────
--
-- El tramo se mide contra el último confirmado anterior. Entonces confirmar
-- —o reabrir— un corte cambia el tramo de TODOS los posteriores del mismo día.
-- Si alguno de ellos ya tiene su diferencia resuelta, el monto que se le cobró
-- a una persona deja de corresponderse con el corte, en silencio.
--
-- `reabrir_corte_caja` ya se protegía del corte propio; faltaba mirar hacia
-- adelante. Vive en una función suelta porque la llaman los dos caminos: si se
-- escribiera dos veces, la próxima corrección arreglaría uno solo.
CREATE OR REPLACE FUNCTION public.corte_trabado_por_posterior(p_corte_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v      public.cortes_caja;
    v_hora text;
BEGIN
    SELECT * INTO v FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT to_char(c2.hora, 'HH24:MI') INTO v_hora
      FROM public.cortes_caja c2
      JOIN public.cortes_caja_diferencias d ON d.corte_id = c2.id AND d.anulada_at IS NULL
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND (c2.hora, c2.id) > (v.hora, v.id)
     ORDER BY c2.hora
     LIMIT 1;

    IF v_hora IS NOT NULL THEN
        RAISE EXCEPTION 'El corte de las % ya tiene su diferencia resuelta y se mide contra este. Hay que anular esa resolucion antes de tocar este corte.', v_hora;
    END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corte_trabado_por_posterior(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corte_trabado_por_posterior(bigint) TO authenticated, service_role;

-- ── 2b + 3. Confirmar en orden, y no pisar lo ya firmado ────────────────────
CREATE OR REPLACE FUNCTION public.resolver_corte_caja(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)
 RETURNS cortes_caja
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte public.cortes_caja;
    v_scope text;
    v_antes text;
    v_prev  text;
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

    IF p_estado = 'CONFIRMADO' THEN
        -- Los cortes son acumulativos: el de la noche contiene al de la manana.
        -- Confirmar salteado le da al de la noche un tramo que en realidad
        -- pertenece a los dos, y le inventa uno al de la manana cuando llega su
        -- turno. Descartar SIEMPRE se puede: es la salida para un conteo malo
        -- que traba la serie.
        SELECT to_char(c2.hora, 'HH24:MI') INTO v_prev
          FROM public.cortes_caja c2
         WHERE c2.branch_id = v_corte.branch_id
           AND c2.fecha     = v_corte.fecha
           AND c2.tipo      = 'C'
           AND c2.estado    = 'PENDIENTE'
           AND (c2.hora, c2.id) < (v_corte.hora, v_corte.id)
         ORDER BY c2.hora
         LIMIT 1;

        IF v_prev IS NOT NULL THEN
            RAISE EXCEPTION 'Antes hay que resolver el corte de las %: los cortes del dia se suman, asi que este se mide contra aquel.', v_prev;
        END IF;

        PERFORM public.corte_trabado_por_posterior(p_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.reabrir_corte_caja(p_id bigint, p_motivo text)
 RETURNS cortes_caja
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

    -- Y despues los de mas tarde, que se miden contra este.
    PERFORM public.corte_trabado_por_posterior(p_id);

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
$function$;

-- ── 7. Un ingreso por sala, exigido por el servidor ─────────────────────────
--
-- `AsentarDiferencias` agrupa por sala Y por signo —cada caja lleva su propio
-- movimiento— pero la funcion solo validaba el signo. Una regla que vive nada
-- mas en la pantalla se rompe el dia que alguien llame al RPC de otra forma, y
-- asentar es irreversible: `anular_diferencia_corte` se niega despues.
CREATE OR REPLACE FUNCTION public.asentar_diferencias_corte(p_ids bigint[], p_ref text)
 RETURNS SETOF cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_signos integer;
    v_salas  integer;
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

    SELECT count(DISTINCT sign(d.monto)), count(DISTINCT d.branch_id)
      INTO v_signos, v_salas
      FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);

    IF v_signos > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar faltantes y sobrantes: son dos documentos distintos.';
    END IF;
    IF v_salas > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar diferencias de dos salas: cada caja lleva su propio movimiento.';
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
$function$;

-- ── 8a. Contar una bolsa exige alcance sobre esa sala ───────────────────────
--
-- Hoy todos los cargos con `bolsas_conteo` son de alcance ALL, asi que no se
-- nota. El dia que se otorgue con alcance BRANCH —que es lo natural si alguna
-- sala cuenta lo suyo— alguien podria firmar el conteo de otra sucursal.
CREATE OR REPLACE FUNCTION public.contar_bolsa(p_id bigint, p_contado numeric, p_esperado numeric)
 RETURNS bolsas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

    IF (SELECT auth_module_scope('bolsas_conteo')) IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

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
$function$;

-- ── 8b. Quien repone tiene que ser de esa sala y estar activo ───────────────
--
-- La clave foranea era todo el control: alcanzaba con que el `employee_id`
-- existiera. Se podia cargar un faltante a alguien de otra sucursal, o a
-- alguien dado de baja. Se acepta la sucursal principal o cualquiera de las
-- asignadas en `employee_branches`, que es como el portal modela a quien cubre
-- en dos salas.
CREATE OR REPLACE FUNCTION public.resolver_diferencia_corte(p_corte_id bigint, p_via text, p_causa text, p_monto_esperado numeric, p_personas jsonb DEFAULT '[]'::jsonb)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte  public.cortes_caja;
    v_scope  text;
    v_monto  numeric;
    v_dif    public.cortes_caja_diferencias;
    v_suma   numeric;
    v_cuenta integer;
    v_ajeno  text;
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

        SELECT coalesce(e.name, 'Esa persona') INTO v_ajeno
          FROM jsonb_array_elements(p_personas) x
          LEFT JOIN public.employees e ON e.id = (x->>'employee_id')::uuid
         WHERE e.id IS NULL
            OR e.status <> 'ACTIVO'
            OR (e.branch_id IS DISTINCT FROM v_corte.branch_id
                AND NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                                 WHERE eb.employee_id = e.id AND eb.branch_id = v_corte.branch_id))
         LIMIT 1;

        IF v_ajeno IS NOT NULL THEN
            RAISE EXCEPTION '% no trabaja en esa sala o ya no esta activa: no puede figurar reponiendo este faltante.', v_ajeno;
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
$function$;

-- ── 6. El invariante, en forma de consulta ──────────────────────────────────
--
-- «Σ bolsas de una sala en un dia == declarado del ultimo corte confirmado».
-- Estaba escrito en el plan como algo que «sale gratis» y no existia en ninguna
-- pantalla, cron ni aviso. Detecta el caso peor: efectivo contado que nunca se
-- guardo. Devuelve TODAS las filas del periodo —tambien las que cuadran— para
-- que la pantalla pueda decir «las seis salas cuadran» en vez de callar.
CREATE OR REPLACE FUNCTION public.get_bolsas_invariante(p_desde date, p_hasta date)
 RETURNS TABLE(branch_id bigint, fecha date, suma_bolsas numeric,
               declarado numeric, descuadre numeric, bolsas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH dias AS (
        SELECT DISTINCT c.branch_id, c.fecha
          FROM public.cortes_caja c
         WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           AND c.fecha BETWEEN p_desde AND p_hasta
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
           AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
                OR c.branch_id = (SELECT auth_employee_branch_id()))
    )
    SELECT d.branch_id, d.fecha,
           coalesce(b.suma, 0),
           coalesce(u.declarado, 0),
           round(coalesce(b.suma, 0) - coalesce(u.declarado, 0), 2),
           coalesce(b.cuantas, 0)::integer
      FROM dias d
      LEFT JOIN LATERAL (
          SELECT sum(x.monto_inicial) AS suma, count(*) AS cuantas
            FROM public.bolsas x
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
      ) b ON true
      LEFT JOIN LATERAL (
          SELECT c.total_declarado AS declarado
            FROM public.cortes_caja c
           WHERE c.branch_id = d.branch_id AND c.fecha = d.fecha
             AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           ORDER BY c.hora DESC, c.id DESC
           LIMIT 1
      ) u ON true
     ORDER BY d.fecha DESC, d.branch_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bolsas_invariante(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bolsas_invariante(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.bolsa_sugerida(bigint) IS
 'Cuanto falta guardar de un corte = declarado - todo lo ya embolsado ese dia. Sin filtro de hora a proposito: los cortes se pueden confirmar en cualquier orden.';
COMMENT ON FUNCTION public.get_bolsas_invariante(date, date) IS
 'Sigma bolsas del dia vs declarado del ultimo corte confirmado. Un descuadre positivo es dinero embolsado de mas; uno negativo, efectivo contado que nunca se guardo.';
