SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El aviso sigue a la TARJETA, no al cierre del día.
--
-- Decisión del usuario (2026-09-04): «¿qué dice el corte? faltante, así que
-- debe notificarlo. Ambos se marcan con faltante, en esos casos debe
-- notificar».
--
-- ── Qué estaba mal, y no era el número ─────────────────────────────────────
-- La versión anterior miraba **cómo cerró la caja**: la diferencia acumulada
-- del último corte confirmado. La pantalla, en cambio, rotula «Faltante» por
-- el **TRAMO** de cada corte. Ayer los dos dieron respuestas opuestas sobre la
-- misma sala:
--
--   Salud 3, 3-sep · 13:01 confirmó +$0.45 de sobrante
--                  · 21:20 confirmó, acumulado $0.00, TRAMO −$0.45
--
-- La tarjeta de las 21:20 dice «FALTANTE −$0.45» y el aviso callaba, porque el
-- día cerró exacto. Las dos cosas eran ciertas y se contradecían — que es
-- justo lo que la migración anterior se propuso evitar cuando eligió el umbral
-- de la pantalla y no uno propio. Se eligió bien el umbral y mal la MAGNITUD.
--
-- Y el caso no es una curiosidad de contabilidad: un sobrante del mediodía que
-- a la noche ya no está es dinero que se movió sin explicación. Con el
-- criterio viejo eso era invisible para siempre.
--
-- ── Ahora: un aviso por CORTE confirmado con faltante ──────────────────────
-- No uno por sala. Con el aviso por sala habría que elegir qué corte nombrar
-- cuando hay dos, y los números de la tarjeta —lo contado, lo esperado, el
-- arrastre— son de UN corte: agregarlos daría una tarjeta que no describe a
-- ninguno. Medido sobre 21 días y 126 días-sala: **3 cortes** en total, o sea
-- un aviso cada siete días para las seis salas juntas. No hay riesgo de ruido.
--
-- La marca en `avisos_emitidos` pasa a ser por corte (`…:<fecha>:<corte_id>`)
-- por lo mismo. Las claves viejas, por sala, quedan huérfanas y no estorban:
-- ninguna se vuelve a consultar.
--
-- ── Lo que viaja para la tarjeta, y por qué el `arrastre` ──────────────────
-- `diferencia` es el TRAMO — el número que la pantalla pinta en grande. Con él
-- solo, «contó $1,288.63 / debía $1,288.63» al lado de «faltan $0.45» sería
-- una contradicción dentro de la misma tarjeta: ese corte contó exacto, y lo
-- que falta viene de que antes sobraba.
--
-- Por eso viaja `arrastre` (lo que el día ya cargaba antes de este corte) con
-- la hora de dónde salió, igual que la línea que la tarjeta del corte muestra
-- desde v2.983.1. La tarjeta del aviso enseña la barra **sólo cuando el
-- arrastre es cero**, que es cuando lo contado y lo esperado cuentan la
-- historia completa.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.avisar_diferencia_de_ayer(p_fecha date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date - 1);
  v_c     record;
  v_dest  uuid[];
  v_clave text;
  v_monto text;
  v_n     integer := 0;
BEGIN
  FOR v_c IN
    WITH conf AS (
      -- Los confirmados del día que SÍ midieron dinero. Un descartado no es un
      -- tramo y uno sin conteo no tiene diferencia que medir: `corte_tramo` los
      -- rechaza a propósito, así que se filtran antes de llamarla.
      SELECT c.id, c.branch_id, c.hora, c.total_declarado,
             public.corte_tramo(c.id) AS tramo,
             round(public.corte_diferencia(c.total_declarado, c.diferencia_erp, c.tk_total_caja,
                                           c.tk_subtotal, c.tk_vales, c.tk_cobros_credito,
                                           c.cobros_portal_efectivo), 2) AS acum
        FROM public.cortes_caja c
       WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO' AND c.fecha = v_fecha
         AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado,
                                                c.diferencia_erp, c.tk_total_caja)
    )
    SELECT k.id AS corte_id, k.branch_id, k.hora, k.total_declarado AS contado,
           k.tramo, b.name AS sala,
           -- Lo que el día ya cargaba ANTES de este corte. Mismo gemelo que
           -- `conTramo` en `cortesDiagnostico.js`.
           round(k.acum - k.tramo, 2) AS arrastre,
           -- De dónde salió: el último confirmado anterior que movió el
           -- acumulado. Se nombra sólo si fue UNO; con varios, la tarjeta dice
           -- cuántos — nombrar uno de tres manda a revisar el corte equivocado.
           (SELECT count(*) FROM conf p
             WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)
               AND abs(p.tramo) >= 0.01)                                   AS aportes,
           (SELECT to_char(p.hora, 'HH24:MI') FROM conf p
             WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)
               AND abs(p.tramo) >= 0.01
             ORDER BY p.hora DESC, p.id DESC LIMIT 1)                      AS arrastre_desde
      FROM conf k JOIN public.branches b ON b.id = k.branch_id
     WHERE k.tramo <= -0.01                 -- el mismo umbral de `severidad`
     ORDER BY b.name, k.hora
  LOOP
    -- Ya la resolvieron: no se vuelve a pedir.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                           WHERE d.corte_id = v_c.corte_id AND d.anulada_at IS NULL);

    -- La marca es por CORTE. En `avisos_emitidos` y no en la campana: un
    -- `NOT EXISTS … FROM notifications` pregunta «¿todavía la tiene?», y quien
    -- vacía su campana lo recibe de nuevo.
    v_clave := 'CORTE_DIF_AYER:' || v_fecha::text || ':' || v_c.corte_id;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.avisos_emitidos a
                           WHERE a.clave = v_clave AND a.recipient_id IS NULL);

    v_dest := public.destinatarios_de_cortes(v_c.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    v_monto := '$' || to_char(abs(v_c.tramo), 'FM999,999,990.00');

    PERFORM public.notify_employees(
      v_dest,
      'CORTE_DIFERENCIA_AYER',
      -- Nombra el CORTE, no la caja: es lo que la tarjeta rotula «Faltante», y
      -- decir «la caja cerró con» sobre un día que cerró exacto era la
      -- contradicción que trajo este cambio.
      'Ayer faltaron ' || v_monto || ' en el corte de las ' || to_char(v_c.hora, 'HH24:MI'),
      v_c.sala || ' — el corte de las ' || to_char(v_c.hora, 'HH24:MI')
        || ' quedó ' || v_monto || ' abajo de lo esperado. Hay que revisarlo y '
        || 'registrar la diferencia.',
      '/cortes',
      jsonb_build_object(
        'corte_id',       v_c.corte_id,
        'branch_id',      v_c.branch_id,
        'sala',           v_c.sala,
        'fecha',          v_fecha,
        'hora',           to_char(v_c.hora, 'HH24:MI'),
        'diferencia',     v_c.tramo,
        'contado',        v_c.contado,
        -- Lo que debía haber en ese corte. Derivado, para que los números de la
        -- tarjeta cierren entre ellos.
        'esperado',       round(v_c.contado - v_c.tramo, 2),
        'arrastre',       v_c.arrastre,
        'arrastre_desde', CASE WHEN v_c.aportes = 1 THEN v_c.arrastre_desde END,
        'aportes',        v_c.aportes
      ),
      true,            -- push: es dinero que falta, no es informativo
      v_c.branch_id
    );

    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;
