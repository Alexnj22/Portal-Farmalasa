-- Anular una bolsa NO le suma su efectivo a otra bolsa.
--
-- ── El reporte ─────────────────────────────────────────────────────────────
-- «al anularlo le sumó a la bolsa anterior, eso es incorrecto, el dinero no
-- salió, al anularlo jamás ese dinero pasa a la bolsa anterior.»
--
-- Medido, Salud 4 del 3-sep: el corte 713 se descartó, su bolsa S4-1246
-- ($467.41) se anuló, y `reajustar_bolsas_del_dia` le sumó esos $467.41 a
-- S4-1240, que pasó de $661.25 a $1,128.66 y quedó con la etiqueta invalidada.
--
-- ── Por qué estaba mal ─────────────────────────────────────────────────────
-- S4-1240 es una bolsa FÍSICA, sellada y etiquetada con $661.25. Anular otra
-- bolsa no mete un solo billete adentro: la cuenta cuadraba en la pantalla y
-- la etiqueta pasaba a prometer $467.41 que nadie puso ahí. O sea que el
-- reparto arreglaba el invariante rompiendo la única cosa que el invariante
-- existe para vigilar — que lo que dice la etiqueta sea lo que hay adentro.
-- Ver [[feedback_restar_el_saldo_supone_que_el_otro_lado_ya_lo_resto]]: la
-- misma familia, compensar en un lado dando por hecho un movimiento que en el
-- otro lado no ocurrió.
--
-- ── Y el hueco se cierra solo, que es el punto ─────────────────────────────
-- El camino por el que se anula una bolsa es el descarte de su corte
-- (`bolsa_al_descartar_corte`). El corte que lo reemplaza vuelve a crear una
-- bolsa con `bolsa_sugerida` = declarado − lo que ya está en las bolsas del
-- día, y como la anulada ya no cuenta, la bolsa nueva nace con el efectivo que
-- quedó sin respaldo. No hacía falta mover nada; alcanzaba con no moverlo.
--
-- Si nadie rehace el corte, el hueco queda VISIBLE: `get_bolsas_invariante` lo
-- muestra como descuadre negativo en la pantalla, y esta función avisa. Eso es
-- lo que se quiere — un hueco señalado, no un hueco tapado escribiendo dinero
-- donde no está.
--
-- La función conserva su nombre y su firma (la llaman `anular_bolsa` y
-- `bolsa_al_descartar_corte`) y sigue devolviendo la diferencia, pero ya no
-- escribe en ninguna bolsa: sólo mide y avisa.

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
    v_hasta     timestamptz;
    v_suma      numeric;
    v_falta     numeric;
    v_sala      text;
BEGIN
    IF p_branch_id IS NULL OR p_fecha IS NULL THEN RETURN 0; END IF;

    -- Lo declarado del día es el ÚLTIMO corte confirmado, no la suma de todos:
    -- los cortes son acumulativos y el de la noche contiene al de la mañana.
    -- Misma cuenta que `get_bolsas_invariante`, a propósito.
    SELECT c.total_declarado, c.capturado_at INTO v_declarado, v_hasta
      FROM public.cortes_caja c
     WHERE c.branch_id = p_branch_id AND c.fecha = p_fecha
       AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
     ORDER BY c.hora DESC, c.id DESC
     LIMIT 1;

    IF v_declarado IS NULL THEN RETURN 0; END IF;

    SELECT coalesce(sum(public.bolsa_saldo_para_el_corte(b.id, v_hasta)), 0) INTO v_suma
      FROM public.bolsas b
     WHERE b.branch_id = p_branch_id AND b.fecha = p_fecha AND b.estado <> 'ANULADA';

    v_falta := round(v_declarado - v_suma, 2);
    IF v_falta = 0 THEN RETURN 0; END IF;

    SELECT name INTO v_sala FROM public.branches WHERE id = p_branch_id;

    IF v_falta < 0 THEN
        -- Las bolsas prometen más de lo que el corte declaró. No se le baja el
        -- monto a nada: sacar efectivo de un respaldo en silencio no lo decide
        -- una función.
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

    -- Falta efectivo por guardar. NO se le suma a ninguna bolsa: el dinero de
    -- una bolsa anulada nunca entró en otra. Se avisa, y lo normal es que la
    -- bolsa del próximo corte lo absorba sola.
    PERFORM public.notify_employees(
        public.destinatarios_de_modulo(p_branch_id::integer, 'bolsas'),
        'bolsas_del_dia_sin_cuadrar',
        'Quedó efectivo del día sin guardar',
        format('%s · %s: faltan $%s por guardar en una bolsa. Si el corte se rehace, la bolsa nueva ya los incluye; si no, hay que revisarlo a mano.',
               coalesce(v_sala, 'Sala'), to_char(p_fecha, 'DD/MM/YYYY'),
               to_char(v_falta, 'FM999,999,990.00')),
        '/cortes',
        jsonb_build_object('branch_id', p_branch_id, 'fecha', p_fecha, 'falta', v_falta),
        true,
        p_branch_id::integer);

    RETURN v_falta;
END;
$function$;

COMMENT ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) IS
  'Mide el efectivo del día contra lo declarado por el último corte confirmado cuando una bolsa se anula, y AVISA. No escribe en ninguna bolsa: el efectivo de una bolsa anulada no pasa a otra —esa otra es una bolsa física ya sellada— y el hueco lo cierra sola la bolsa del corte que reemplaza al descartado. La cuenta es la MISMA que la de get_bolsas_invariante a propósito: bolsa_saldo_para_el_corte. Ver la migración anular_una_bolsa_no_le_suma_efectivo_a_otra.';

REVOKE EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) TO service_role;

-- ── El dato ya escrito ─────────────────────────────────────────────────────
-- La bolsa 241 (S4-1240) se devolvió a $661.25 con su etiqueta original, y el
-- REAJUSTAR de la corrección quedó en `bolsas_eventos`. Se aplicó por separado
-- el 2026-09-03; queda escrito acá para que la historia se lea completa.
