SET lock_timeout = '5s';

-- ── La propuesta sale el 28, no el 25 ──────────────────────────────────────
--
-- Decisión del usuario (2026-08-25): «cambiemos del 25 al 28 el cálculo de
-- meta, para tener una meta más real». Con el mes en curso ya adentro de la
-- fórmula, cada día de espera es un día menos de proyección — y se mide.
--
-- Enfrentando la proyección contra el cierre REAL de mayo, junio y julio:
--
--            error medio    peor caso
--   24 días     ~2.0%       $3,585.91  (julio)
--   27 días     ~1.2%       $1,394.16  (julio)
--
-- El error se parte casi a la mitad. El costo es la otra cara: quedan 2-3 días
-- para confirmar y aprobar antes de que arranque el mes, y en FEBRERO queda
-- uno solo (el 28 es el último día). Ahí la red es el recordatorio del día 1,
-- que ya avisa a supervisión y gerencia que el mes en curso sigue sin meta
-- oficial.
--
-- ── Dos cosas que se rompían al mover el número ────────────────────────────
--
-- 1. **El recordatorio «Metas sin confirmar» estaba clavado en el 28.** Con la
--    propuesta también el 28, la MISMA corrida que las crea manda el aviso de
--    que están sin confirmar. Pasa a ser «desde el día siguiente al de la
--    propuesta», que es lo que siempre quiso decir.
--
-- 2. **Mover el día no habría cambiado la meta de septiembre.**
--    `generar_propuestas_metas` inserta con `ON CONFLICT DO NOTHING` —correcto:
--    correrla dos veces no puede pisar un número que alguien ya está mirando—,
--    así que el 28 no habría tocado las filas creadas el 25 y la meta seguiría
--    calculada con 24 días. El día de la propuesta ahora también REHACE lo que
--    ya estaba, con los tres frenos de `recalcular_propuestas_metas`: sólo un
--    mes que no empezó, sólo `propuesta`/`devuelta`, y sólo si nadie la ajustó
--    a mano. En un mes normal no cambia nada (las acaba de crear con los mismos
--    datos); en un mes ya propuesto, las pone al día.
--
--    Y si rehace algo, se AVISA. Un número que se mueve solo entre que el
--    supervisor lo miró y lo confirma es exactamente lo que no puede pasar en
--    silencio: `generar_...` sólo notifica cuando inserta, así que sin este
--    aviso el cambio no habría dejado rastro visible en ningún lado.

UPDATE public.metas_config SET dia_propuesta = 28;

CREATE OR REPLACE FUNCTION public.metas_ciclo_diario()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dia integer := EXTRACT(day FROM v_hoy)::int;
  v_ym_actual text := to_char(v_hoy, 'YYYY-MM');
  v_ym_sig text := to_char((date_trunc('month', v_hoy) + interval '1 month')::date, 'YYYY-MM');
  v_ym_ant text := to_char((date_trunc('month', v_hoy) - interval '1 month')::date, 'YYYY-MM');
  v_dia_propuesta integer;
  v_creadas integer := 0;
  v_rehechas integer := 0;
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;
  v_dia_propuesta := COALESCE(v_dia_propuesta, 28);

  IF v_dia = v_dia_propuesta THEN
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';

    -- Las que ya existían (mes propuesto antes, o el día corrido) se ponen al
    -- día con las ventas de hoy. No toca confirmadas, oficiales ni ajustadas.
    v_rehechas := public.recalcular_propuestas_metas(v_ym_sig,
      'el portal las rehizo el día de la propuesta con las ventas hasta hoy');
    IF v_rehechas > 0 THEN
      v_out := v_out || 'rehechas=' || v_rehechas || ' ';
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
        'Metas recalculadas para ' || public.metas_mes_label(v_ym_sig),
        v_rehechas || ' meta(s) que ya estaban propuestas se rehicieron con las ventas '
        || 'hasta hoy. Las que ya habías ajustado o confirmado no se tocaron.');
    END IF;
  END IF;

  -- El mes que cerró queda congelado con las reglas que regían ese mes.
  IF v_dia = 5 THEN
    v_n := public.congelar_metas_mes(v_ym_ant, false);
    v_out := v_out || 'congelado_' || v_ym_ant || '=' || v_n || ' ';
  END IF;

  -- El aviso a la sala va DESPUÉS de congelar: el 5, si el congelado acaba de
  -- escribirse, el número de la campana es ya el del histórico.
  IF v_dia BETWEEN 1 AND 5 THEN
    v_n := public.metas_avisar_cierre_a_salas(v_ym_ant, v_dia = 5);
    IF v_n > 0 THEN
      v_out := v_out || 'aviso_salas_' || v_ym_ant || '=' || v_n || ' ';
    END IF;
  END IF;

  -- Desde el día SIGUIENTE al de la propuesta: recordarle a alguien que no
  -- confirmó lo que se creó esta misma mañana no es un recordatorio.
  IF v_dia > v_dia_propuesta THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_sig AND estado IN ('propuesta', 'devuelta');
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'Metas sin confirmar',
        'Quedan ' || v_n || ' meta(s) de ' || public.metas_mes_label(v_ym_sig) || ' sin confirmar.');
      v_out := v_out || 'rec_supervisor=' || v_n || ' ';
    END IF;
  END IF;

  IF v_dia >= 30 OR v_dia <= 5 THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month IN (v_ym_actual, v_ym_sig) AND estado = 'confirmada_supervisor';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'Metas por aprobar',
        v_n || ' meta(s) confirmadas esperan tu aprobación.');
      v_out := v_out || 'rec_gerente=' || v_n || ' ';
    END IF;
  END IF;

  -- Días 1, 3 y después una vez por semana: el mes en curso sin oficializar es
  -- una situación que dura, no una novedad diaria. Es además la única red en
  -- FEBRERO, donde el 28 es el último día y no hay «día siguiente».
  IF v_dia IN (1, 3, 8, 15, 22, 29) THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_actual AND estado <> 'oficial';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
        v_n || ' sala(s) aún no tienen su meta oficial. Las salas la ven como pendiente.');
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
        v_n || ' sala(s) aún no tienen su meta oficial.');
      v_out := v_out || 'pendientes_mes_actual=' || v_n;
    END IF;
  END IF;

  RETURN COALESCE(NULLIF(v_out, ''), 'sin novedades');
END;
$function$;
