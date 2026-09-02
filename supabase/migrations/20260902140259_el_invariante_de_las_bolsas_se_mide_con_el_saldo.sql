SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El invariante de las bolsas se mide con el SALDO, no con la etiqueta.
--
-- `bolsa_sugerida` pasó a restar `bolsa_saldo` el 2026-09-02 (migración
-- 20260902032330) porque a una bolsa se le puede SACAR dinero y entonces lo que
-- tiene adentro ya no es lo que dice su etiqueta. Esa corrección llegó a UNA de
-- las tres piezas que hacían la misma cuenta.
--
-- Las otras dos —este invariante y `reajustar_bolsas_del_dia`— seguían sumando
-- `monto_inicial`, y con la fórmula VIEJA eso era una tautología: la bolsa nueva
-- nacía como `declarado − suma de las etiquetas del día`, así que después de
-- insertarla la suma daba el declarado POR CONSTRUCCIÓN. Medido sobre los 54
-- días-sala del circuito: los 54 daban la igualdad exacta al centavo. O sea que
-- el único control que mira el caso peor comparaba un número contra sí mismo, y
-- sólo podía detectar dos cosas — días sin ninguna bolsa, y bolsas anuladas.
--
-- La cuenta correcta, fija en el tiempo:
--
--   suma de las etiquetas del día  +  vales que salieron ANTES  ==  declarado
--
-- «Antes» es antes de que se creara la última bolsa del día, que es el estado
-- exacto que vio `bolsa_sugerida` al calcularla — las dos mitades miden con la
-- misma vara. Y es estable: los vales que salen DESPUÉS bajan el saldo de hoy
-- pero no mueven el invariante, que es lo que impide que un día viejo se ponga
-- rojo solo al ir saliendo su dinero.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_bolsas_invariante(p_desde date, p_hasta date)
 RETURNS TABLE(branch_id bigint, fecha date, suma_bolsas numeric, declarado numeric, descuadre numeric, bolsas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH dias AS (
        SELECT c.branch_id, c.fecha
          FROM public.cortes_caja c
         WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           AND c.fecha BETWEEN p_desde AND p_hasta
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
           AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
                OR c.branch_id = (SELECT auth_employee_branch_id()))
         GROUP BY c.branch_id, c.fecha
        HAVING min(c.resuelto_at) >= public.bolsas_circuito_desde()
    )
    SELECT d.branch_id, d.fecha,
           round(coalesce(b.etiquetas, 0) + coalesce(v.vales, 0), 2),
           coalesce(u.declarado, 0),
           round(coalesce(b.etiquetas, 0) + coalesce(v.vales, 0) - coalesce(u.declarado, 0), 2),
           coalesce(b.cuantas, 0)::integer
      FROM dias d
      LEFT JOIN LATERAL (
          SELECT sum(x.monto_inicial) AS etiquetas,
                 count(*)             AS cuantas,
                 -- El momento de referencia: cuando se creó la última bolsa del
                 -- día. No la hora del corte, porque un vale registrado entre el
                 -- conteo y la confirmación SÍ lo vio `bolsa_sugerida`.
                 max(x.created_at)    AS ref
            FROM public.bolsas x
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
      ) b ON true
      LEFT JOIN LATERAL (
          -- `monto` ya viene con signo: negativo la salida, positivo el reintegro.
          SELECT sum(m.monto) AS vales
            FROM public.bolsas_movimientos m
            JOIN public.bolsas x ON x.id = m.bolsa_id
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
             AND m.anulado_at IS NULL
             AND m.registrado_at < b.ref
      ) v ON true
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Y el reajuste mueve lo que la anulación se llevó, no una diferencia del día.
--
-- Calculaba `declarado − suma de las etiquetas` y movía eso. Con el invariante
-- tautológico esa resta daba SIEMPRE el monto de la bolsa recién anulada, que es
-- lo único que había que mover; con el invariante de verdad deja de darlo, y en
-- un día que ya venía corto absorbería también el hueco viejo — o sea, le
-- inventaría a una bolsa dinero que nadie contó. Medido en Salud 3 del 31-ago:
-- la resta vieja da $324.80 (correcto) y la nueva daría $624.80.
--
-- Sus dos llamadores anulan una bolsa SIN vales adentro —`anular_bolsa` lo
-- exige y el disparador del corte descartado sólo entra con cero—, así que el
-- hueco que abren es exactamente su `monto_inicial`. Se lo pasan.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.reajustar_bolsas_del_dia(bigint, date, uuid);

CREATE FUNCTION public.reajustar_bolsas_del_dia(
    p_branch_id   bigint,
    p_fecha       date,
    p_employee_id uuid,
    p_monto       numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_falta numeric;
    v_bolsa public.bolsas;
    v_sala  text;
BEGIN
    IF p_branch_id IS NULL OR p_fecha IS NULL THEN RETURN 0; END IF;

    v_falta := round(coalesce(p_monto, 0), 2);
    IF v_falta <= 0 THEN RETURN 0; END IF;

    SELECT name INTO v_sala FROM public.branches WHERE id = p_branch_id;

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

REVOKE EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid, numeric) TO service_role;

-- Los dos llamadores: le pasan el monto de la bolsa que acaban de anular.

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
    -- quede abierta ese día. Sin esto, anular deja un hueco que nada avisa. Y el
    -- hueco es su propio monto —acá arriba se exigió que no tuviera vales
    -- adentro—, no una diferencia del día: ver el encabezado de
    -- `reajustar_bolsas_del_dia`.
    PERFORM public.reajustar_bolsas_del_dia(v_bolsa.branch_id, v_bolsa.fecha,
                                            (SELECT auth_employee_id()),
                                            v_bolsa.monto_inicial);

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
        -- anular la primera dejaba su monto sin ninguna bolsa detrás. Entra acá
        -- sólo con `v_n = 0`, así que el hueco es su monto entero.
        PERFORM public.reajustar_bolsas_del_dia(b.branch_id, b.fecha, NEW.resuelto_por,
                                                b.monto_inicial);
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
