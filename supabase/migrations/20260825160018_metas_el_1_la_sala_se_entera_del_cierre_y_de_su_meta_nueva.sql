SET lock_timeout = '5s';

-- ── El 1 la sala se entera de cómo cerró y de cuánto le toca ────────────────
--
-- `get_meta_sala` —el widget del Inicio— pide SIEMPRE el mes en curso, y el mes
-- lo calcula el servidor. O sea que a las 00:00 del día 1 la tarjeta salta al
-- mes nuevo y el resultado del mes que la sala estuvo persiguiendo 30 días
-- desaparece de la pantalla sin que nadie se lo haya dicho. Y la meta nueva
-- aparece ahí, en silencio, junto con todo lo demás.
--
-- Las dos mitades del aviso son el mismo hecho contado entero: cómo terminó lo
-- anterior y qué se le pide ahora.
--
-- ── Por qué el aviso NO habla en dólares para todos ────────────────────────
-- El portal ya decidió quién ve montos de venta y quién ve porcentajes: es
-- `dash_meta_sala_vista_completa`, y el widget cambia de idioma según eso.
-- Medido el 2026-08-25: de las 35 personas de sala que ven la meta, **28 no
-- tienen ese permiso** (dependientes y regentes). Mandar un aviso con
-- «vendiste $40,466.52» a todas abriría por la campana justo lo que la
-- pantalla cierra. Por eso hay DOS cuerpos y no uno, resueltos por persona.
--
-- Y el aviso sólo va a quien puede ver la meta: en Salud 4 hay un técnico de
-- mantenimiento asignado a la sala que no tiene `dash_meta_sala`. `notify_branch`
-- le escribiría igual, porque avisa a toda la sucursal.
--
-- ── Por qué una ventana del 1 al 5 y no sólo el 1 ──────────────────────────
-- El día 1 a las 08:00 SV el mes ya está completo: medido sobre mayo, junio y
-- julio, la última factura de cada mes entró a las ~22:00 SV de ese mismo día.
-- Pero si un día del mes no tiene fila —un sync que no corrió—, el resultado
-- saldría bajo y ya estaría dicho. Así que el aviso EXIGE que el mes esté
-- completo y reintenta hasta el 5, sin repetirse (la dedupe es por
-- `metadata->>'ym_cerrado'`).
--
-- El 5 es el último intento y ahí se afloja la otra condición: si la meta nueva
-- todavía no está oficial, el aviso sale igual con el resultado solo. Callarse
-- por una meta que nadie confirmó dejaría a la sala sin saber cómo cerró, que
-- es el dato que ya no puede ver en ninguna pantalla.
--
-- El 5 es además el día en que `congelar_metas_mes` escribe `metas_resultado`;
-- este aviso prefiere ese número cuando existe, para que lo que dice la campana
-- sea exactamente lo que va a decir el histórico para siempre.

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_salas(
  p_ym_cerrado text,
  p_ultimo_intento boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym_nuevo    text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes    integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_n           integer;
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;

  WITH
  cerrado AS (
    SELECT d.branch_id::bigint AS branch_id,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_ym_cerrado
    GROUP BY 1
  ),
  salas AS (
    SELECT c.branch_id,
           -- El congelado manda cuando ya existe: la campana no puede decir un
           -- número y el histórico otro.
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta_cerrada,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct,
           mn.monto_meta AS meta_nueva
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    LEFT JOIN public.metas_sucursal mn
           ON mn.branch_id = c.branch_id AND mn.year_month = v_ym_nuevo
          AND mn.estado = 'oficial'
    -- Un mes con días faltantes daría un resultado bajo, y ya estaría dicho.
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
      AND (mn.year_month IS NOT NULL OR p_ultimo_intento)
  ),
  destinatarios AS (
    SELECT e.id AS employee_id, s.branch_id, s.venta, s.meta_cerrada, s.pct, s.meta_nueva,
           EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'dash_meta_sala_vista_completa'
                      AND rp.can_view
                      AND rp.role_id IN (e.role_id, e.secondary_role_id)) AS ve_montos
    FROM salas s
    JOIN public.employees e ON e.branch_id = s.branch_id AND e.status = 'ACTIVO'
    WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'dash_meta_sala'
                     AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'METAS_CIERRE_SALA',
           CASE WHEN d.pct IS NULL
                THEN 'Así cerró ' || public.metas_mes_label(p_ym_cerrado)
                ELSE 'Cerraste ' || public.metas_mes_label(p_ym_cerrado) || ' en ' || d.pct || '%'
           END,
           -- Primera oración: el mes que cerró. Segunda: el que empieza.
           CASE
             WHEN d.ve_montos AND d.pct IS NOT NULL THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || ' de tu meta de $' || to_char(d.meta_cerrada, 'FM999,999,990.00') || '. '
             WHEN d.ve_montos THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || '. Ese mes no tuvo meta. '
             ELSE ''
           END
           ||
           CASE
             WHEN d.meta_nueva IS NULL THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo) || ' todavía se está definiendo.'
             WHEN d.ve_montos THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' es $' || to_char(d.meta_nueva, 'FM999,999,990.00') || '.'
             ELSE
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' ya está publicada. Mírala en Inicio.'
           END,
           '/overview',
           jsonb_build_object('ym_cerrado', p_ym_cerrado, 'ym_nuevo', v_ym_nuevo),
           d.branch_id::integer
    FROM destinatarios d
    -- Una vez por persona y por mes cerrado: la ventana del 1 al 5 reintenta,
    -- no repite.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.recipient_id = d.employee_id
         AND n.type = 'METAS_CIERRE_SALA'
         AND n.metadata ->> 'ym_cerrado' = p_ym_cerrado
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) IS
  'Avisa a cada sala cómo cerró el mes y cuál es su meta nueva. Dos cuerpos: con montos para quien tiene dash_meta_sala_vista_completa, en porcentaje para el resto. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) TO service_role;


-- ── El ciclo diario lo dispara ─────────────────────────────────────────────
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
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;

  IF v_dia = COALESCE(v_dia_propuesta, 25) THEN
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';
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

  IF v_dia >= 28 THEN
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
  -- una situación que dura, no una novedad diaria.
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
