SET lock_timeout = '5s';

-- `get_product_sales_total` es el caso de la trampa 4 de CLAUDE.md: `LANGUAGE
-- sql` CON cláusula `SET`. El `SET` la vuelve opaca —no se inlinea— y además su
-- cuerpo se planifica UNA sola vez con los argumentos como `Params`: nace
-- genérica y no hay plan personalizado que pedir.
--
-- Acá el plan SÍ depende de los argumentos, y se ve en una línea. El cuerpo
-- filtra con `(p_branch_id IS NULL OR x.branch_id = p_branch_id)`. Con un valor,
-- `4 IS NULL` se pliega a falso, el OR desaparece y `branch_id = 4` entra como
-- **Index Cond** de `idx_psma_covering` y de `idx_si_branch_fecha_full`. Con el
-- parámetro no puede: queda como Filter y hay que leer las otras seis salas para
-- tirarlas.
--
-- Medido en producción, en caliente, mismos argumentos y **mismo resultado**
-- ($372,972.44212389380530428414 en los dos):
--
--   por la función          28,909 bloques · 226 MB · 60 ms
--   el cuerpo con literales 14,360 bloques · 112 MB · 47 ms
--
-- O sea que lee EL DOBLE para dar la misma respuesta. Lo que cuenta acá son los
-- bloques y no los milisegundos: una lectura ocupa una ranura del pool de
-- PostgREST en proporción a lo que lee, y es así como dos personas paginando
-- llenan el pool y el portal entero devuelve 504.
--
-- ⚠️ Esto NO contradice la auditoría del 2026-08-25, que declaró esta función
-- «sana · 1.0×» en `scripts/planes-genericos.json`. Aquélla midió TIEMPO y
-- acertó: 15–237 ms contra 8–235 ms de la candidata, y mis números en caliente
-- coinciden (60 contra 47). Lo que nadie midió fueron los BLOQUES, que es la
-- métrica de la sección F —la que existe desde el 2026-09-01— y la que no se
-- mueve con la carga. Es el mismo patrón que ya está escrito en CLAUDE.md: una
-- afirmación que nadie vuelve a verificar deja de ser cierta, y acá ni siquiera
-- era falsa — era sobre otra cosa.
--
-- La corrección es la que CLAUDE.md ya manda para este caso y **no toca el
-- cuerpo**: pasarla a `plpgsql` —que sí entra al caché de planes— y ahí sí
-- `SET plan_cache_mode TO 'force_custom_plan'`. El costo es replanificar cada
-- llamada, ~5 ms medidos; contra 114 MB de lectura de más, se paga solo.
--
-- El `DEFAULT NULL` de `p_branch_id` se conserva: sin él `CREATE OR REPLACE`
-- ni siquiera entra («cannot remove parameter defaults»), y el portal la llama
-- sin ese argumento cuando mira todas las salas.

CREATE OR REPLACE FUNCTION public.get_product_sales_total(
    p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET plan_cache_mode TO 'force_custom_plan'
AS $fn$
DECLARE
    v_total numeric;
BEGIN
    -- El cuerpo es el de siempre, envuelto para poder devolverlo desde plpgsql.
    -- No se le cambió un predicado: lo único que cambia es QUIÉN lo planifica y
    -- con qué información.
    SELECT t.total INTO v_total FROM (

WITH
bounds AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS curr_month,
    LEAST(p_ffin, date_trunc('month', CURRENT_DATE)::date - 1) AS past_to
),
bounds2 AS (
  SELECT curr_month, past_to,
    CASE WHEN p_fini = date_trunc('month', p_fini)::date
         THEN to_char(p_fini, 'YYYY-MM')
         ELSE to_char((date_trunc('month', p_fini) + interval '1 month')::date, 'YYYY-MM') END AS ym_full_from,
    CASE WHEN past_to = (date_trunc('month', past_to) + interval '1 month' - interval '1 day')::date
         THEN to_char(past_to, 'YYYY-MM')
         ELSE to_char((date_trunc('month', past_to) - interval '1 month')::date, 'YYYY-MM') END AS ym_full_to,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN p_fini END AS pl_from,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN LEAST(past_to, (date_trunc('month', p_fini) + interval '1 month' - interval '1 day')::date) END AS pl_to
  FROM bounds
),
bounds3 AS (
  SELECT b.*,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN GREATEST(date_trunc('month', b.past_to)::date, p_fini, COALESCE(b.pl_to + 1, p_fini)) END AS pr_from,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN b.past_to END AS pr_to
  FROM bounds2 b
),
src AS (
  -- meses completos, del agregado mensual (== ventas en vivo, verificado al centavo)
  SELECT a.erp_product_id, a.neto
  FROM public.product_sales_monthly_agg a
  CROSS JOIN bounds3 b
  WHERE p_fini < b.curr_month
    AND a.year_month >= b.ym_full_from
    AND a.year_month <= b.ym_full_to
    AND a.year_month <  to_char(b.curr_month, 'YYYY-MM')
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
  UNION ALL
  -- borde parcial izquierdo
  SELECT sii.erp_product_id,
         CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric / 1.13 END
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  CROSS JOIN bounds3 b
  WHERE si.fecha BETWEEN b.pl_from AND b.pl_to
    AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  UNION ALL
  -- borde parcial derecho
  SELECT sii.erp_product_id,
         CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric / 1.13 END
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  CROSS JOIN bounds3 b
  WHERE si.fecha BETWEEN b.pr_from AND b.pr_to
    AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  UNION ALL
  -- mes en curso, en vivo
  SELECT sii.erp_product_id,
         CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric / 1.13 END
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE si.fecha BETWEEN GREATEST(p_fini, date_trunc('month', CURRENT_DATE)::date) AND p_ffin
    AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
)
SELECT COALESCE(SUM(s.neto), 0)
FROM src s
LEFT JOIN public.products p ON p.id = s.erp_product_id
WHERE NOT COALESCE(p.oculto_en_ventas, false)

    ) t(total);

    RETURN COALESCE(v_total, 0);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_product_sales_total(date, date, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_product_sales_total(date, date, integer) TO authenticated, service_role;
