-- Descartar un corte no reparte nada: el reparto se elimina entero.
--
-- ── Lo que dijo el usuario, y cierra el asunto ─────────────────────────────
-- «si descarté un corte reabierto, significa que fue error, o pasó algo; si
-- quisiera guardar dinero confirmaría un corte y lo guardaría.»
--
-- O sea: un corte descartado NO deja efectivo huérfano esperando quién lo
-- respalde. Deja de existir, y con él su bolsa. El único acto que guarda
-- dinero es confirmar un corte, que crea su bolsa con `bolsa_sugerida`. No hay
-- hueco que repartir porque no hubo dinero que mover.
--
-- ── Y el arreglo anterior fue a la sobrecarga equivocada ───────────────────
-- `anular_una_bolsa_no_le_suma_efectivo_a_otra` (hace media hora) reescribió
-- `reajustar_bolsas_del_dia(bigint, date, uuid)` — tres argumentos, la que
-- mide la diferencia del día. Los DOS llamadores reales usan la de CUATRO,
-- `(bigint, date, uuid, numeric)`, que recibe el monto de la bolsa anulada y
-- se lo suma a la última bolsa abierta. Esa siguió intacta y es la que sumó
-- los $467.41 a S4-1240.
--
-- Es exactamente `update_proveedor_manual` otra vez (CLAUDE.md §4): dos
-- sobrecargas, el arreglo alcanza a una sola, y nada avisa — la función
-- corregida compila, se aplica y no la llama nadie. Ver
-- [[feedback_el_arreglo_de_un_canonico_no_llega_a_su_gemelo]].
--
-- Por eso acá no se corrige la función: se BORRAN las dos y se les quitan las
-- llamadas a los dos llamadores. Una sobrecarga que no existe no puede volver
-- a estrenarse sola.
--
-- Lo que queda vigilando el día es `get_bolsas_invariante`, que compara la
-- suma de las bolsas contra lo declarado por el último corte CONFIRMADO — y
-- un corte descartado ya no es el último confirmado, así que el día vuelve a
-- cuadrar solo, sin que nadie escriba un monto.
--
-- Verificado en Salud 4 del 3-sep, con el día ya cerrado: bolsas vivas
-- $661.25 (S4-1240) + $885.52 (S4-1250) = $1,546.77, que es exactamente lo
-- declarado por el corte 734, el último confirmado. Con el reparto puesto,
-- S4-1240 habría quedado en $1,128.66 y el día sumaría $467.41 de MÁS.

SET lock_timeout = '5s';

-- ── 1. El descarte del corte: anula su bolsa y nada más ────────────────────
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
    --
    -- Y ahí termina. Su monto NO se le pasa a otra bolsa: las otras son bolsas
    -- físicas ya selladas y etiquetadas, y sumarles un número las haría
    -- prometer efectivo que nadie puso adentro. Un corte descartado es un
    -- error o algo que pasó — el que quiere guardar dinero confirma un corte,
    -- y ese corte crea su bolsa.
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
$function$;

COMMENT ON FUNCTION public.bolsa_al_descartar_corte() IS
  'Al descartarse un corte, su bolsa se anula si sigue limpia y en la sala; si tiene vales o ya salió, no se toca y se avisa. No reparte su monto entre las demás bolsas: el efectivo de una bolsa anulada no entra en ninguna otra. Ver la migración descartar_un_corte_no_reparte_efectivo_se_deshace.';

-- ── 2. Anular a mano: igual, sin reparto ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_bolsa(p_id bigint, p_motivo text)
 RETURNS public.bolsas
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

    -- El efectivo que respaldaba esta bolsa vuelve a la caja y ahí se queda: no
    -- se le pasa a otra bolsa. La que quede abierta es una bolsa física con su
    -- etiqueta puesta, y sumarle este monto le haría prometer dinero que no
    -- tiene adentro. Si el día queda con menos guardado que lo declarado, lo
    -- muestra `get_bolsas_invariante` en la pantalla.
    RETURN v_bolsa;
END;
$function$;

COMMENT ON FUNCTION public.anular_bolsa(bigint, text) IS
  'Anula una bolsa ABIERTA y sin vales adentro, exigiendo motivo y permiso de edición sobre su sala. No reparte su monto: el efectivo de una bolsa anulada no entra en ninguna otra bolsa. Ver la migración descartar_un_corte_no_reparte_efectivo_se_deshace.';

-- ── 3. Y el reparto deja de existir ────────────────────────────────────────
-- Las dos sobrecargas, para que no quede una viva esperando un llamador.
DROP FUNCTION IF EXISTS public.reajustar_bolsas_del_dia(bigint, date, uuid, numeric);
DROP FUNCTION IF EXISTS public.reajustar_bolsas_del_dia(bigint, date, uuid);
