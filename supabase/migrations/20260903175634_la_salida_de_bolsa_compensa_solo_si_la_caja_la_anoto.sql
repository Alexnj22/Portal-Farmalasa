-- La salida de una bolsa sólo la compensa el corte si la caja YA la anotó.
--
-- ── El aviso que cierra ────────────────────────────────────────────────────
-- Salud 2, 2-sep: «Un día cerró con menos efectivo guardado del que declaró el
-- corte — faltan $460.00 de $1,571.07». El dinero estaba bien y la bolsa
-- también: el aviso salía de una cuenta que daba por hecho algo que no había
-- pasado.
--
-- La cadena, medida:
--
--   S2-1229 nació con $1,073.52 (corte de la 1:01 pm)
--   dos salidas POS Promerica le sacaron $220.00 y $240.00  →  quedan $613.52
--   NINGUNA de las dos se anotó como vale en la caja (`caja_vale_id` NULL)
--   el corte de las 7:00 pm declaró $1,571.07  ← con los $460 adentro
--   `bolsa_sugerida` restó el SALDO: 1,571.07 − 613.52 = $957.55
--   y en el cajón había $497.55, que es lo que el Gerente General mandó poner
--
-- `bolsa_sugerida` restaba el saldo real de las bolsas del día desde el 2-sep
-- (`bolsa_sugerida_descuenta_el_saldo`), y esa cuenta es correcta **sólo si el
-- corte ya descontó esa salida**. Se cumple cuando el vale se anotó en la caja
-- —Salud 3 el 1-sep: el $119.38 aparece en los movimientos del día como
-- «VALE DE CAJA 1 (1 salida)», así que el declarado venía neto— y no se cumple
-- cuando nadie lo anotó, que es lo que pasa cada vez que el corte se toma desde
-- la caja y no desde el portal: `hacer-corte-caja` anota los pendientes antes de
-- pedir el corte, la caja no.
--
-- Medido el 2-sep, las tres salas con salidas de bolsa:
--
--   Salud 3   3 salidas, vale 8 anotado 03:00:32  ·  corte capturado 03:00:41  → compensa
--   Salud 4   1 salida,  vale 7 anotado 02:59:20  ·  corte capturado 03:00:40  → compensa
--   Salud 2   2 salidas, sin vale                                              → NO compensa
--
-- ── La regla, dicha UNA vez para los tres que la usan ───────────────────────
-- `bolsa_saldo_para_el_corte(bolsa, hasta)` es el saldo de la bolsa medido con
-- la vara del corte: descuenta sólo las salidas cuyo vale ya estaba anotado en
-- la caja cuando ese corte se tomó. NO reemplaza a `bolsa_saldo`, que sigue
-- siendo el dinero que la bolsa tiene de verdad — el que se cuenta, el que
-- limita un reintegro y el que valida la próxima salida.
--
-- La usan las tres piezas que antes decían lo mismo con tres cuentas distintas:
--   · `bolsa_sugerida`          cuánto va en la bolsa nueva
--   · `get_bolsas_invariante`   el aviso de la pantalla
--   · `reajustar_bolsas_del_dia` el reparto cuando una bolsa se anula
--     (ésta se había quedado sumando `monto_inicial` a secas desde el 24-ago)
--
-- ── Lo que este cambio NO hace: apagar el control ───────────────────────────
-- Con la vara nueva el día de Salud 2 cuadra en $0.00 — pero si la etiqueta
-- hubiera quedado en los $957.55 que puso la fórmula, el mismo control diría
-- «guardaron $460.00 de MÁS», que es exactamente lo que pasaba: las etiquetas
-- prometían efectivo que ya no estaba en ninguna bolsa. El aviso no desaparece,
-- cambia de lado y apunta al defecto real — el vale que nadie anotó.
--
-- Verificado contra producción sobre todos los días que el invariante juzga
-- (desde `bolsas_invariante_desde`, 6 días-sala): con la vara vieja uno marcaba
-- −$460.00; con la nueva, los seis en $0.00.

SET lock_timeout = '5s';

-- ── El saldo, pero medido con la vara del corte ─────────────────────────────
CREATE OR REPLACE FUNCTION public.bolsa_saldo_para_el_corte(
    p_bolsa_id bigint,
    p_hasta    timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
    SELECT round(b.monto_inicial + coalesce((
        SELECT sum(m.monto)
          FROM public.bolsas_movimientos m
          JOIN public.caja_vales_portal cv ON cv.id = m.caja_vale_id
         WHERE m.bolsa_id   = b.id
           AND m.anulado_at IS NULL
           AND cv.anotado_at IS NOT NULL
           AND cv.anotado_at < p_hasta
    ), 0), 2)
      FROM public.bolsas b
     WHERE b.id = p_bolsa_id;
$function$;

COMMENT ON FUNCTION public.bolsa_saldo_para_el_corte(bigint, timestamptz) IS
    'El saldo de la bolsa como lo vio el corte: descuenta SÓLO las salidas cuyo vale ya estaba anotado en la caja antes de p_hasta (el capturado_at del corte). Lo que salió sin anotarse no lo descontó el corte, así que tampoco se descuenta acá. Para el dinero que la bolsa tiene de verdad —contar, reintegrar, validar la próxima salida— es bolsa_saldo.';

REVOKE EXECUTE ON FUNCTION public.bolsa_saldo_para_el_corte(bigint, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bolsa_saldo_para_el_corte(bigint, timestamptz) TO authenticated, service_role;

-- ── 1. Cuánto va en la bolsa nueva ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bolsa_sugerida(p_corte_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT round(c.total_declarado - coalesce((
        SELECT sum(public.bolsa_saldo_para_el_corte(b.id, c.capturado_at))
          FROM public.bolsas b
         WHERE b.branch_id = c.branch_id
           AND b.fecha     = c.fecha
           AND b.estado   <> 'ANULADA'
    ), 0), 2)
      FROM public.cortes_caja c
     WHERE c.id = p_corte_id;
$function$;

COMMENT ON FUNCTION public.bolsa_sugerida(bigint) IS
    'Cuánto efectivo va en la bolsa que nace de este corte: lo declarado menos lo que ya está en las bolsas del día, medido con bolsa_saldo_para_el_corte — o sea descontando sólo las salidas que la caja ya tenía anotadas cuando se tomó el corte. Una salida sin anotar no bajó el declarado, así que tampoco puede agrandar la bolsa nueva.';

-- ── 2. El aviso de la pantalla ─────────────────────────────────────────────
--
-- `suma_bolsas` pasa a ser la suma de los saldos-para-el-corte, que es la
-- MISMA función con la que se calculó cada bolsa: las dos mitades del circuito
-- miden con la misma vara y la igualdad vuelve a significar algo.
CREATE OR REPLACE FUNCTION public.get_bolsas_invariante(p_desde date, p_hasta date)
RETURNS TABLE(branch_id bigint, fecha date, suma_bolsas numeric, declarado numeric, descuadre numeric, bolsas integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
        HAVING min(c.resuelto_at) >= public.bolsas_invariante_desde()
    )
    SELECT d.branch_id, d.fecha,
           round(coalesce(b.suma, 0), 2),
           coalesce(u.declarado, 0),
           round(coalesce(b.suma, 0) - coalesce(u.declarado, 0), 2),
           coalesce(b.cuantas, 0)::integer
      FROM dias d
      -- Primero el corte: su `capturado_at` es la vara con la que se miden las
      -- bolsas, así que tiene que estar resuelto antes.
      LEFT JOIN LATERAL (
          SELECT c.total_declarado AS declarado, c.capturado_at
            FROM public.cortes_caja c
           WHERE c.branch_id = d.branch_id AND c.fecha = d.fecha
             AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           ORDER BY c.hora DESC, c.id DESC
           LIMIT 1
      ) u ON true
      LEFT JOIN LATERAL (
          SELECT sum(public.bolsa_saldo_para_el_corte(x.id, u.capturado_at)) AS suma,
                 count(*) AS cuantas
            FROM public.bolsas x
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
      ) b ON true
     ORDER BY d.fecha DESC, d.branch_id;
$function$;

COMMENT ON FUNCTION public.get_bolsas_invariante(date, date) IS
    'El invariante del circuito por sala y día: la suma de las bolsas —medida con bolsa_saldo_para_el_corte, o sea descontando sólo las salidas que la caja ya tenía anotadas— contra lo declarado por el último corte confirmado. Negativo: se guardó de menos. Positivo: las etiquetas prometen efectivo que no está en ninguna bolsa, que es lo que pasa cuando una salida no se anota como vale. Devuelve también los días que cuadran, a propósito.';

-- ── 3. El reparto cuando una bolsa se anula ────────────────────────────────
--
-- Sumaba `monto_inicial` a secas —la vara del 24-ago— así que desde el 2-sep
-- medía distinto que las otras dos y le habría devuelto a la bolsa que absorbe
-- el monto de las salidas anotadas.
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
    v_bolsa     public.bolsas;
    v_sala      text;
BEGIN
    IF p_branch_id IS NULL OR p_fecha IS NULL THEN RETURN 0; END IF;

    -- Lo declarado del día es el ÚLTIMO corte confirmado, no la suma de todos:
    -- los cortes son acumulativos y el de la noche contiene al de la mañana.
    -- Misma cuenta que `get_bolsas_invariante`, a propósito — si las dos se
    -- separan, el gate mediría una cosa y el arreglo haría otra.
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

    -- Sobran bolsas para lo declarado: no se le baja el monto a nada. Ver el
    -- encabezado de `al_anular_una_bolsa_el_dia_se_vuelve_a_repartir` — sacar
    -- efectivo de un respaldo en silencio no lo decide una función.
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
  'Vuelve a repartir el efectivo del día cuando una bolsa se anula: lo que quedó sin respaldo lo absorbe la última bolsa que sigue ABIERTA en la sala, y su etiqueta vuelve a estar sin imprimir. Sólo suma; si sobra, o si no queda ninguna bolsa en la sala, avisa y no toca nada. La cuenta es la MISMA que la de get_bolsas_invariante a propósito — bolsa_saldo_para_el_corte. Ver las migraciones al_anular_una_bolsa_el_dia_se_vuelve_a_repartir y la_salida_de_bolsa_compensa_solo_si_la_caja_la_anoto.';

REVOKE EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reajustar_bolsas_del_dia(bigint, date, uuid) TO service_role;
