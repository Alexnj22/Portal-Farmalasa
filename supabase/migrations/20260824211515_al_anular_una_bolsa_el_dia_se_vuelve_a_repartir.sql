-- Anular una bolsa dejaba el efectivo del día sin ninguna bolsa que lo respalde.
--
-- Reportado por el usuario el 2026-08-24:
--
--   «en salud 1 se habían confirmado 2 cortes, así que el último salían $30 y
--    algo (lo cual era incorrecto), así que anulé el anterior, y volví a
--    reimprimir el último para que me dé la cantidad correcta en bolsa de
--    efectivo, pero sigue en $30 y algo»
--
-- ── Qué pasó, medido en la bitácora ───────────────────────────────────────
--
-- La bolsa de un corte parcial NO guarda el total del corte: guarda **lo que
-- entró desde el corte anterior**. `bolsa_sugerida` es
-- `total_declarado − las bolsas del día que siguen vivas`, y eso es correcto,
-- porque los cortes del día son acumulativos.
--
--   14:49  se confirma el corte de $839.09   → nace S1-1118 = 839.09
--   15:04  se confirma el corte de $877.64   → nace S1-1119 =  38.55
--   15:06  se descarta el corte de las 14:42 → S1-1118 queda ANULADA
--   15:07  se reabre y reconfirma el último  → no hace NADA
--
-- Los $839.09 quedaron sin bolsa: la sala terminó el día con **$38.55 en
-- bolsas contra $877.64 declarados**. Y las dos salidas que se intentaron no
-- podían servir: reimprimir sólo sube `etiqueta_version`, y reconfirmar entra
-- en `crear_bolsa_al_confirmar`, que se corta apenas ve que el corte ya tiene
-- bolsa.
--
-- **El modo de falla es el silencio.** No hay error, ninguna pantalla se rompe,
-- y el número que queda es plausible: $38.55 es un monto que podría ser cierto.
-- Lo único que lo delata es `get_bolsas_invariante`, que mide exactamente este
-- descuadre desde el día uno — y que nadie mira.
--
-- ── La asimetría que lo explica ───────────────────────────────────────────
--
-- «Los cortes del día se suman» ya estaba entendido: `resolver_corte_caja` no
-- deja confirmar salteado, y `corte_trabado_por_posterior` frena si un corte
-- posterior ya tiene su DIFERENCIA resuelta. La misma cadena existe en las
-- bolsas y ahí no se aplicó: anular una bolsa cambia la base contra la que se
-- calcularon las de después, y nada lo recalculaba.
--
-- ── La regla, decidida por el usuario ─────────────────────────────────────
--
-- **La bolsa ABIERTA del día absorbe lo que quedó sin respaldo, y su etiqueta
-- vuelve a estar sin imprimir.** Es lo correcto y no un parche: el efectivo
-- nunca se movió —`bolsa_al_descartar_corte` sólo anula sola una bolsa que
-- sigue ABIERTA y sin vales—, así que sigue en la caja, y la bolsa siguiente
-- es la que legítimamente lo cubre. Poner `etiqueta_impresa_at` en NULL es la
-- otra mitad: la etiqueta impresa dice un monto que ya no es, y el portal tiene
-- que pedir que se imprima de nuevo, no dejar un papel mintiendo sobre una
-- bolsa.
--
-- **Sólo SUMA, nunca resta.** Si las bolsas superan lo declarado, avisa y no
-- toca nada: bajarle el monto a una bolsa cuya etiqueta ya se pegó es sacar
-- efectivo de un respaldo en silencio, y eso lo tiene que mirar una persona.
--
-- **Y si no queda ninguna bolsa ABIERTA que pueda absorberlo, avisa.** Una
-- bolsa que ya salió de la sala fue contada contra su número: cambiárselo
-- después inventaría una diferencia que nadie tuvo. Para eso está el circuito
-- de diferencias del conteo.
--
-- ── Por qué NO se bloquea reabrir en vez de recalcular ────────────────────
--
-- La alternativa era extender `corte_trabado_por_posterior` para que no deje
-- reabrir un corte cuando la bolsa de uno posterior ya salió de la sala. Se
-- descartó a propósito: descartar un corte es la salida para un conteo malo que
-- traba la serie —está escrito así en `resolver_corte_caja`— y para descartarlo
-- primero hay que reabrirlo. Un freno ahí le quita la escapatoria a quien tiene
-- razón, que es la misma trampa que ya se decidió evitar al no validar el
-- motivo de un envío contra el dato.
--
-- Verificado contra producción, rehaciendo el escenario del usuario entero
-- —dos cortes de $500 y $800, bolsas de $500 y $300, se descarta el primero—
-- e insertándolo y revirtiéndolo en la misma transacción: la bolsa de $300
-- queda en $800, su etiqueta vuelve a «sin imprimir», y la suma viva iguala lo
-- declarado. Correr la función dos veces devuelve 0 la segunda: no suma dos
-- veces.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reajustar_bolsas_del_dia(
  p_branch_id  bigint,
  p_fecha      date,
  p_employee_id uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_declarado numeric;
    v_suma      numeric;
    v_falta     numeric;
    v_bolsa     public.bolsas;
    v_sala      text;
BEGIN
    IF p_branch_id IS NULL OR p_fecha IS NULL THEN RETURN 0; END IF;

    -- Lo declarado del día es el ÚLTIMO corte confirmado, no la suma de todos:
    -- los cortes son acumulativos y el de la noche contiene al de la mañana.
    -- Misma cuenta que `get_bolsas_invariante`, a propósito — si las dos se
    -- separan, el gate mediría una cosa y el arreglo haría otra.
    SELECT c.total_declarado INTO v_declarado
      FROM public.cortes_caja c
     WHERE c.branch_id = p_branch_id AND c.fecha = p_fecha
       AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
     ORDER BY c.hora DESC, c.id DESC
     LIMIT 1;

    IF v_declarado IS NULL THEN RETURN 0; END IF;

    SELECT coalesce(sum(b.monto_inicial), 0) INTO v_suma
      FROM public.bolsas b
     WHERE b.branch_id = p_branch_id AND b.fecha = p_fecha AND b.estado <> 'ANULADA';

    v_falta := round(v_declarado - v_suma, 2);
    IF v_falta = 0 THEN RETURN 0; END IF;

    SELECT name INTO v_sala FROM public.branches WHERE id = p_branch_id;

    -- Sobran bolsas para lo declarado: no se le baja el monto a nada. Ver el
    -- encabezado — sacar efectivo de un respaldo en silencio no lo decide una
    -- función.
    IF v_falta < 0 THEN
        PERFORM public.notify_employees(
            public.destinatarios_de_modulo(p_branch_id::integer, 'bolsas'),
            'bolsas_del_dia_sin_cuadrar',
            'Las bolsas del día suman más que el corte',
            format('%s · %s: las bolsas suman $%s y el último corte confirmado declara $%s. Hay $%s de más y eso se revisa a mano.',
                   coalesce(v_sala, 'Sala'), to_char(p_fecha, 'DD/MM/YYYY'),
                   to_char(v_suma, 'FM999,999,990.00'),
                   to_char(v_declarado, 'FM999,999,990.00'),
                   to_char(abs(v_falta), 'FM999,999,990.00')),
            '/cortes',
            jsonb_build_object('branch_id', p_branch_id, 'fecha', p_fecha, 'sobra', abs(v_falta)),
            true,
            p_branch_id::integer);
        RETURN v_falta;
    END IF;

    -- La que absorbe es la ÚLTIMA bolsa que sigue en la sala. La última porque
    -- el hueco lo dejó un corte anterior al suyo, y en la sala porque una que ya
    -- salió fue contada contra su número.
    SELECT * INTO v_bolsa
      FROM public.bolsas b
     WHERE b.branch_id = p_branch_id AND b.fecha = p_fecha AND b.estado = 'ABIERTA'
     ORDER BY b.hora DESC, b.id DESC
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM public.notify_employees(
            public.destinatarios_de_modulo(p_branch_id::integer, 'bolsas'),
            'bolsas_del_dia_sin_cuadrar',
            'Quedó efectivo del día sin bolsa',
            format('%s · %s: faltan $%s por guardar y no queda ninguna bolsa en la sala donde ponerlos. Hay que revisarlo a mano.',
                   coalesce(v_sala, 'Sala'), to_char(p_fecha, 'DD/MM/YYYY'),
                   to_char(v_falta, 'FM999,999,990.00')),
            '/cortes',
            jsonb_build_object('branch_id', p_branch_id, 'fecha', p_fecha, 'falta', v_falta),
            true,
            p_branch_id::integer);
        RETURN v_falta;
    END IF;

    UPDATE public.bolsas
       SET monto_inicial       = round(monto_inicial + v_falta, 2),
           -- La etiqueta impresa dice un monto que ya no es. Vuelve a «sin
           -- imprimir» para que la pantalla lo pida sola.
           etiqueta_impresa_at = NULL,
           etiqueta_version    = etiqueta_version + 1,
           updated_at          = now()
     WHERE id = v_bolsa.id;

    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id, nota)
    VALUES (v_bolsa.id, 'REAJUSTAR', v_bolsa.estado, v_bolsa.estado,
            'Se anuló una bolsa del día y este efectivo quedó sin respaldo.',
            round(v_bolsa.monto_inicial + v_falta, 2), p_employee_id,
            format('De $%s a $%s. Hay que imprimir la etiqueta de nuevo.',
                   to_char(v_bolsa.monto_inicial, 'FM999,999,990.00'),
                   to_char(v_bolsa.monto_inicial + v_falta, 'FM999,999,990.00')));

    RETURN v_falta;
END;
$function$;

COMMENT ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) IS
  'Vuelve a repartir el efectivo del día cuando una bolsa se anula: lo que quedó sin respaldo lo absorbe la última bolsa que sigue ABIERTA en la sala, y su etiqueta vuelve a estar sin imprimir. Sólo suma; si sobra, o si no queda ninguna bolsa en la sala, avisa y no toca nada. La cuenta de «lo declarado» es la MISMA que la de get_bolsas_invariante a propósito. Ver la migración al_anular_una_bolsa_el_dia_se_vuelve_a_repartir.';

REVOKE EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) TO service_role;

-- ── Los dos caminos por los que una bolsa se anula ────────────────────────

CREATE OR REPLACE FUNCTION public.anular_bolsa(p_id bigint, p_motivo text)
 RETURNS bolsas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

    -- El efectivo que respaldaba esta bolsa sigue en la caja: vuelve a la que
    -- quede abierta ese día. Sin esto, anular deja un hueco que nada avisa.
    PERFORM public.reajustar_bolsas_del_dia(v_bolsa.branch_id, v_bolsa.fecha,
                                            (SELECT auth_employee_id()));

    RETURN v_bolsa;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bolsa_al_descartar_corte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

        -- Y el efectivo que respaldaba vuelve a repartirse entre las bolsas que
        -- siguen vivas ese día. Es el caso que se reportó: con dos cortes
        -- confirmados, la segunda bolsa sólo guarda el tramo nuevo, así que
        -- anular la primera dejaba su monto sin ninguna bolsa detrás.
        PERFORM public.reajustar_bolsas_del_dia(b.branch_id, b.fecha, NEW.resuelto_por);
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
$function$;
