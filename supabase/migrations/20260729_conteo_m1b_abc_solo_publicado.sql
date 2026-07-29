SET lock_timeout = '5s';

-- La muestra tomaba COALESCE(abc_class, draft_abc_class). El borrador de MinMax
-- es una propuesta que nadie aprobó todavía (draft_status 'none'/'pending'):
-- decidir QUÉ SE CUENTA a partir de números sin publicar convierte un control
-- en una corazonada. Solo cuenta la clasificación publicada.
--
-- Efecto medido: Bodega tiene 0 publicadas y 2,540 en borrador, y Salud 5 solo
-- 309 de 1,914. Ahí la muestra pasa a ser "bajo receta 100% + rotación por
-- antigüedad sobre el resto", que es exactamente lo correcto para un almacén
-- sin ABC — y respeta que Bodega no se maneje por ABC.

CREATE OR REPLACE FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer DEFAULT 200)
 RETURNS TABLE(erp_product_id integer, segmento text, ultimo_conteo timestamptz)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids int[];
BEGIN
  SELECT array_agg(m.erp_sucursal_id) INTO v_ids FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP'; END IF;

  RETURN QUERY
  WITH universo AS (
    -- Solo lo que la sucursal tiene en existencia hoy: contar lo que no está
    -- ahí no verifica nada.
    SELECT DISTINCT i.erp_product_id AS pid
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_ids)
  ),
  clasificado AS (
    SELECT u.pid,
           CASE
             WHEN p.es_antibiotico THEN 'BAJO_RECETA'
             WHEN COALESCE(sp.abc, '') = 'A' THEN 'A'
             WHEN COALESCE(sp.abc, '') = 'B' THEN 'B'
             ELSE 'C'
           END AS seg
    FROM universo u
    JOIN public.products p ON p.id = u.pid AND p.activo = true
    LEFT JOIN LATERAL (
      -- Solo lo PUBLICADO. El borrador no decide qué se audita.
      SELECT s.abc_class AS abc
      FROM public.product_stock_params s
      WHERE s.erp_product_id = u.pid AND s.erp_sucursal_id = ANY(v_ids)
        AND s.abc_class IS NOT NULL
      LIMIT 1
    ) sp ON true
  ),
  ultimo AS (
    -- Cuándo se contó por última vez ese producto EN ESTA SUCURSAL.
    SELECT ci.erp_product_id AS pid, max(ci.contado_at) AS last_at
    FROM public.conteo_inventario_items ci
    JOIN public.conteos_inventario c ON c.id = ci.conteo_id
    WHERE c.branch_id = p_branch_id AND ci.contado_at IS NOT NULL
    GROUP BY 1
  ),
  pool AS (
    SELECT c.pid, c.seg, u.last_at,
           row_number() OVER (PARTITION BY c.seg ORDER BY u.last_at NULLS FIRST, random()) AS rn
    FROM clasificado c
    LEFT JOIN ultimo u ON u.pid = c.pid
  ),
  cuotas AS (
    SELECT
      LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano) AS q_abx,
      GREATEST(p_tamano - LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano), 0) AS resto
    FROM pool
  ),
  q AS (
    SELECT q_abx,
           floor(resto * 0.60)::int AS q_a,
           floor(resto * 0.25)::int AS q_b,
           resto - floor(resto * 0.60)::int - floor(resto * 0.25)::int AS q_c
    FROM cuotas
  ),
  base AS (
    SELECT p.pid, p.seg, p.last_at
    FROM pool p CROSS JOIN q
    WHERE (p.seg = 'BAJO_RECETA' AND p.rn <= q.q_abx)
       OR (p.seg = 'A'           AND p.rn <= q.q_a)
       OR (p.seg = 'B'           AND p.rn <= q.q_b)
       OR (p.seg = 'C'           AND p.rn <= q.q_c)
  ),
  -- Si un segmento tiene menos productos que su cuota (ej. una sucursal sin ABC
  -- publicado), el faltante se rellena con el resto por prioridad y antigüedad;
  -- si no, la muestra saldría más chica que lo pedido sin motivo.
  relleno AS (
    SELECT p.pid, p.seg, p.last_at
    FROM pool p
    WHERE NOT EXISTS (SELECT 1 FROM base b WHERE b.pid = p.pid)
    ORDER BY CASE p.seg WHEN 'BAJO_RECETA' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
             p.last_at NULLS FIRST, random()
    LIMIT GREATEST(p_tamano - (SELECT count(*) FROM base), 0)
  )
  SELECT b.pid, b.seg, b.last_at FROM base b
  UNION ALL
  SELECT r.pid, r.seg, r.last_at FROM relleno r;
END;
$function$;
