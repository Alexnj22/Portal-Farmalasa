SET lock_timeout = '5s';

-- ── Rehacer una propuesta que todavía nadie confirmó ───────────────────────
--
-- `generar_propuestas_metas` inserta con `ON CONFLICT DO NOTHING`, y eso está
-- bien: correrla dos veces no puede mover un número que alguien ya está
-- mirando. Pero deja un hueco — el día que la FÓRMULA cambia, el mes ya
-- propuesto se queda con la vieja y no hay forma de rehacerlo sin borrar filas
-- a mano.
--
-- Pasó el 2026-08-25: la propuesta de septiembre salió a las 08:00 con los tres
-- meses cerrados (mayo·junio·julio) y el arreglo que hace entrar agosto llegó
-- esa misma mañana.
--
-- Tres frenos, y ninguno es decorativo:
--
--  1. **Sólo un mes que todavía no empezó.** Rehacer la meta del mes que la
--     sala está vendiendo sería mover el arco con el partido jugándose.
--  2. **Sólo `propuesta` o `devuelta`.** Una confirmada o una oficial ya son la
--     palabra de alguien; recalcularlas es pisar una decisión.
--  3. **Sólo si nadie la tocó a mano.** `upsert_meta_manual` cambia
--     `monto_base` y NO toca `monto_propuesto`, así que la igualdad entre los
--     dos es la prueba de que el número sigue siendo el del portal. Si no lo
--     es, la fila se saltea: el ajuste del supervisor manda sobre la fórmula.
--     Y si `monto_propuesto` viene en NULL no se puede probar nada, así que
--     tampoco se toca — el freno falla del lado seguro.
--
-- No se abre a `authenticated`: hoy no hay botón que la llame, y una función
-- que escribe metas expuesta sin quien la use es superficie por las dudas.

CREATE OR REPLACE FUNCTION public.metas_nota_propuesta(
  p_ym_ultimo  text,
  p_pct        numeric,
  p_proyectado boolean,
  p_factor     numeric
)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_pct IS NULL THEN
      'Propuesta del sistema: el ritmo diario de los últimos 3 meses por los días del mes. '
      || 'El mes anterior no tuvo meta, así que no hay cumplimiento que medir y no se pide '
      || 'crecimiento (factor 1.00)'
    WHEN p_proyectado THEN
      'Propuesta del sistema: el ritmo diario de los últimos 3 meses —'
      || public.metas_mes_label(p_ym_ultimo) || ' proyectado a fin de mes— por los días '
      || 'del mes, con factor ' || p_factor || ' por venir cerrándolo en ' || p_pct || '%'
    ELSE
      'Propuesta del sistema: el ritmo diario de los últimos 3 meses por los días del mes, '
      || 'con factor ' || p_factor || ' por haber cerrado ' || public.metas_mes_label(p_ym_ultimo)
      || ' en ' || p_pct || '%'
  END;
$$;

COMMENT ON FUNCTION public.metas_nota_propuesta(text, numeric, boolean, numeric) IS
  'La nota que acompaña a una propuesta, en un solo lugar: la escriben generar_propuestas_metas y recalcular_propuestas_metas.';

REVOKE EXECUTE ON FUNCTION public.metas_nota_propuesta(text, numeric, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_nota_propuesta(text, numeric, boolean, numeric) TO service_role;


-- La que escribe usa la misma nota que la que rehace.
CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_creadas integer;
  v_b bigint;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;

  WITH
  ins AS (
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           public.metas_nota_propuesta(c.ym_ultimo, c.pct_ultimo, c.ultimo_proyectado, c.factor)
    FROM public.metas_calculo_propuesta(p_year_month) c
    WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING id, branch_id, year_month, monto_meta
  ),
  log AS (
    INSERT INTO public.metas_historial
      (meta_id, branch_id, year_month, evento, estado_despues, monto_despues, nota)
    SELECT i.id, i.branch_id, i.year_month, 'propuesta_generada', 'propuesta', i.monto_meta,
           'la calculó el portal con el ritmo de los últimos meses y el factor de cumplimiento'
    FROM ins i
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM log;

  FOR v_b IN SELECT DISTINCT c.branch_id FROM public.metas_gasto_cuota c
             WHERE c.year_month = p_year_month AND c.estado = 'pendiente' LOOP
    PERFORM public.metas_aplicar_recuperacion(v_b, p_year_month);
  END LOOP;

  IF v_creadas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
      'Metas propuestas para ' || public.metas_mes_label(p_year_month),
      v_creadas || ' sala(s) ya tienen su meta propuesta. Revísalas, ajústalas y confírmalas.');
  END IF;

  RETURN v_creadas;
END;
$function$;


CREATE OR REPLACE FUNCTION public.recalcular_propuestas_metas(
  p_year_month text,
  p_motivo     text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_motivo text := NULLIF(btrim(p_motivo), '');
  v_n integer := 0;
  v_r record;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;
  -- Un mes que ya empezó no se rehace: la sala está vendiendo contra él.
  IF p_year_month <= v_ym_actual THEN
    RAISE EXCEPTION 'MES_YA_EMPEZO: % no se puede rehacer', p_year_month;
  END IF;
  -- Sin motivo escrito no se rehace nada: el historial tiene que poder decir
  -- por qué un número cambió sin que nadie lo pidiera.
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO';
  END IF;

  FOR v_r IN
    SELECT m.id, m.branch_id, m.estado, m.monto_base AS antes,
           c.propuesta, c.ym_ultimo, c.pct_ultimo, c.ultimo_proyectado, c.factor
      FROM public.metas_sucursal m
      JOIN public.metas_calculo_propuesta(p_year_month) c ON c.branch_id = m.branch_id
     WHERE m.year_month = p_year_month
       AND m.estado IN ('propuesta', 'devuelta')
       AND m.monto_propuesto IS NOT NULL
       AND m.monto_base = m.monto_propuesto        -- nadie la ajustó a mano
       AND c.propuesta IS DISTINCT FROM m.monto_base
     ORDER BY m.branch_id
     FOR UPDATE OF m
  LOOP
    UPDATE public.metas_sucursal
       SET monto_base      = v_r.propuesta,
           monto_propuesto = v_r.propuesta,
           monto_meta      = v_r.propuesta + monto_recuperacion,
           nota            = public.metas_nota_propuesta(
                               v_r.ym_ultimo, v_r.pct_ultimo, v_r.ultimo_proyectado, v_r.factor)
     WHERE id = v_r.id;

    PERFORM public.metas_log(v_r.id, 'propuesta_recalculada',
      v_r.estado, v_r.estado, v_r.antes, v_r.propuesta, v_motivo);

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.recalcular_propuestas_metas(text, text) IS
  'Rehace las propuestas de un mes que todavía no empezó, sólo las que siguen en propuesta/devuelta y que nadie ajustó a mano. Exige motivo y lo deja en metas_historial.';

REVOKE EXECUTE ON FUNCTION public.recalcular_propuestas_metas(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recalcular_propuestas_metas(text, text) TO service_role;
