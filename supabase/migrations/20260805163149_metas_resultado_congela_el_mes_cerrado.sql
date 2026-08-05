SET lock_timeout = '5s';

-- `get_metas_historico` derivaba el tramo del bono EN VIVO contra
-- `metas_config`: mover `bono_pct_venta` (0.5%) o `umbral_bono_medio` (95)
-- reescribía el resultado de los 20 meses ya cerrados, incluidos los bonos que
-- ya se pagaron. El plan original decidió lo contrario desde el día uno («el
-- histórico NO se recalcula si una regla cambia después») y nunca se
-- implementó.
--
-- Cada mes cerrado congela su resultado CON LAS REGLAS QUE REGÍAN ESE MES.
CREATE TABLE IF NOT EXISTS public.metas_resultado (
  branch_id          bigint  NOT NULL,
  year_month         text    NOT NULL,
  -- La meta como estaba, con sus dos mitades.
  monto_base         numeric,
  monto_recuperacion numeric,
  monto_meta         numeric,
  venta_total        numeric NOT NULL,
  pct_cumplimiento   numeric,
  bono_tier          text,
  bolsa              numeric,
  -- Las reglas vigentes ese mes, copiadas. Sin esto, congelar el resultado no
  -- serviría de nada: no se podría explicar de dónde salió.
  umbral_total       numeric,
  umbral_medio       numeric,
  bono_pct_venta     numeric,
  pago_medio_pct     numeric,
  margen_pct         numeric,
  nota               text,
  congelado_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, year_month)
);

ALTER TABLE public.metas_resultado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metas_resultado_select ON public.metas_resultado;
CREATE POLICY metas_resultado_select ON public.metas_resultado
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
-- Sin policies de escritura: solo la congela el RPC de abajo.

-- ── Congelar un mes ─────────────────────────────────────────────────────────
-- `p_forzar` existe para un solo caso legítimo: corregir la meta de un mes ya
-- cerrado (que `upsert_meta_manual` permite, exigiendo el porqué). Sin eso, la
-- corrección no se vería nunca en el histórico.
CREATE OR REPLACE FUNCTION public.congelar_metas_mes(
    p_year_month text, p_forzar boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_n integer;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;
  -- Un mes en curso no se congela: todavía se está vendiendo.
  IF p_year_month >= v_ym_actual THEN
    RAISE EXCEPTION 'MES_NO_CERRADO: % todavía no terminó', p_year_month;
  END IF;

  WITH
  cfg AS (SELECT * FROM public.metas_config LIMIT 1),
  sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
  ventas AS (
    SELECT d.branch_id, SUM(d.sum_total)::numeric AS neto
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_year_month
      AND d.branch_id IN (SELECT s.branch_id FROM sucs s)
    GROUP BY d.branch_id
  ),
  claves AS (
    SELECT v.branch_id FROM ventas v
    UNION
    SELECT m.branch_id FROM public.metas_sucursal m
    WHERE m.year_month = p_year_month
      AND m.branch_id IN (SELECT s.branch_id FROM sucs s)
  ),
  calc AS (
    SELECT k.branch_id,
           m.monto_base, m.monto_recuperacion, m.monto_meta, m.nota,
           ROUND(COALESCE(v.neto, 0), 2) AS venta,
           CASE WHEN m.monto_meta > 0
                THEN ROUND(COALESCE(v.neto, 0) / m.monto_meta * 100, 1) END AS pct,
           CASE WHEN m.monto_meta IS NULL OR m.monto_meta <= 0 THEN NULL
                WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
                WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
                ELSE 'nada' END AS tier,
           c.umbral_bono_total, c.umbral_bono_medio, c.bono_pct_venta,
           c.pago_medio_pct, c.margen_recuperacion_pct
    FROM claves k
    LEFT JOIN public.metas_sucursal m
           ON m.branch_id = k.branch_id AND m.year_month = p_year_month
    LEFT JOIN ventas v ON v.branch_id = k.branch_id
    CROSS JOIN cfg c
  ),
  ins AS (
    INSERT INTO public.metas_resultado
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       venta_total, pct_cumplimiento, bono_tier, bolsa,
       umbral_total, umbral_medio, bono_pct_venta, pago_medio_pct, margen_pct, nota)
    SELECT c.branch_id, p_year_month, c.monto_base, c.monto_recuperacion, c.monto_meta,
           c.venta, c.pct, c.tier,
           -- La bolsa del bono, con la tasa de ESE mes.
           ROUND(c.venta * COALESCE(CASE c.tier
             WHEN 'completo' THEN c.bono_pct_venta
             WHEN 'medio'    THEN ROUND(c.bono_pct_venta * c.pago_medio_pct / 100, 6)
             ELSE 0 END, 0) / 100, 2),
           c.umbral_bono_total, c.umbral_bono_medio, c.bono_pct_venta,
           c.pago_medio_pct, c.margen_recuperacion_pct, c.nota
    FROM calc c
    ON CONFLICT (branch_id, year_month) DO UPDATE
      SET monto_base = EXCLUDED.monto_base,
          monto_recuperacion = EXCLUDED.monto_recuperacion,
          monto_meta = EXCLUDED.monto_meta,
          venta_total = EXCLUDED.venta_total,
          pct_cumplimiento = EXCLUDED.pct_cumplimiento,
          bono_tier = EXCLUDED.bono_tier,
          bolsa = EXCLUDED.bolsa,
          umbral_total = EXCLUDED.umbral_total,
          umbral_medio = EXCLUDED.umbral_medio,
          bono_pct_venta = EXCLUDED.bono_pct_venta,
          pago_medio_pct = EXCLUDED.pago_medio_pct,
          margen_pct = EXCLUDED.margen_pct,
          nota = EXCLUDED.nota,
          congelado_at = now()
      WHERE p_forzar          -- sin forzar, lo congelado NO se toca jamás
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.congelar_metas_mes(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.congelar_metas_mes(text, boolean) TO service_role;

-- ── El histórico lee lo congelado, y deriva SOLO lo que aún no lo está ──────
-- La unión es lo que evita un hueco: entre que un mes cierra y el día 5 que lo
-- congela, esas filas tienen que seguir apareciendo.
CREATE OR REPLACE FUNCTION public.get_metas_historico()
RETURNS TABLE(year_month text, branch_id bigint, monto_meta numeric,
              venta_total numeric, pct_cumplimiento numeric, bono_tier text, nota text)
LANGUAGE sql STABLE
SET search_path TO ''
AS $function$
WITH
lim AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date AS mes_actual_ini,
         to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM') AS ym_hoy
),
sucs AS (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE NOT m.es_bodega),
congelado AS (
  SELECT r.year_month, r.branch_id, r.monto_meta, r.venta_total,
         r.pct_cumplimiento, r.bono_tier, r.nota
  FROM public.metas_resultado r
),
ventas AS (
  SELECT d.branch_id, to_char(d.date, 'YYYY-MM') AS ym, SUM(d.sum_total) AS neto
  FROM public.sales_daily_stats d
  CROSS JOIN lim
  WHERE d.date >= '2025-05-01'
    AND d.date < lim.mes_actual_ini
    AND d.branch_id IN (SELECT s.branch_id FROM sucs s)
  GROUP BY d.branch_id, to_char(d.date, 'YYYY-MM')
),
claves AS (
  SELECT v.branch_id, v.ym FROM ventas v
  UNION
  SELECT m.branch_id, m.year_month FROM public.metas_sucursal m
  CROSS JOIN lim
  WHERE m.year_month < lim.ym_hoy
    AND m.branch_id IN (SELECT s.branch_id FROM sucs s)
),
derivado AS (
  SELECT
    k.ym AS year_month,
    k.branch_id,
    m.monto_meta,
    ROUND(COALESCE(v.neto, 0), 2) AS venta_total,
    CASE WHEN m.monto_meta > 0
         THEN ROUND(COALESCE(v.neto, 0) / m.monto_meta * 100, 1) END AS pct_cumplimiento,
    CASE WHEN m.monto_meta IS NULL THEN NULL
         WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
         WHEN COALESCE(v.neto, 0) / m.monto_meta * 100 >= c.umbral_bono_medio THEN 'medio'
         ELSE 'nada' END AS bono_tier,
    m.nota
  FROM claves k
  LEFT JOIN public.metas_sucursal m ON m.branch_id = k.branch_id AND m.year_month = k.ym
  LEFT JOIN ventas v ON v.branch_id = k.branch_id AND v.ym = k.ym
  CROSS JOIN public.metas_config c
  WHERE NOT EXISTS (
    SELECT 1 FROM congelado g WHERE g.branch_id = k.branch_id AND g.year_month = k.ym
  )
)
SELECT * FROM congelado
UNION ALL
SELECT * FROM derivado
ORDER BY 1 DESC, 4 DESC;
$function$;

-- ── Congelar la historia que ya existe ──────────────────────────────────────
DO $$
DECLARE m text;
BEGIN
  FOR m IN
    SELECT DISTINCT to_char(d.date, 'YYYY-MM')
    FROM public.sales_daily_stats d
    WHERE d.date >= '2025-01-01'
      AND to_char(d.date, 'YYYY-MM') < to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM')
    UNION
    SELECT DISTINCT s.year_month FROM public.metas_sucursal s
    WHERE s.year_month < to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM')
  LOOP
    PERFORM public.congelar_metas_mes(m, false);
  END LOOP;
END $$;

-- Verificado tras el backfill, comparando fila por fila contra la fórmula vieja
-- EN LAS DOS DIRECCIONES: 109 filas de cada lado, 0 que no coincidan, 0 sin
-- congelar y 0 congeladas de más.
--
-- Y la prueba de fondo, en una transacción revertida: con la config movida a
-- umbral 95→80, total 100→90 y bono 0.5%→2%, `get_metas_historico` devolvió
-- EXACTAMENTE lo mismo (jul-2026 La Popular siguió en 108.6% · completo).
-- Volver a congelar sin forzar tocó 0 filas; con forzar, 6.
-- Congelar el mes en curso → MES_NO_CERRADO.
