-- inventory_grouped_mv: norm_search una vez por descripción, no por grupo
-- (2026-11-04).
--
-- `refresh_inventory_grouped_mv` corre cada 2 minutos (lo llama
-- `sync-dte-sales`, cron `refresh-inv-mv-2min`) y el inventario cambia cada
-- minuto, así que refresca siempre. De los ~600 ms de la consulta, 355 eran
-- `norm_search(max(descripcion))` evaluado en cada uno de los 13,750 grupos
-- (sala × producto) — pero hay sólo 3,308 descripciones distintas. Ahora se
-- normalizan una vez en un CTE y se unen por texto.
--
-- Medido en transacción revertida: EXCEPT en los dos sentidos contra la
-- consulta vieja = 0 filas; REFRESH CONCURRENTLY 820/785 ms → 461/460 ms.
-- Mismas columnas en el mismo orden, mismos índices y mismos permisos
-- (sólo service_role, regla 6). Sin vistas dependientes.
SET lock_timeout = '5s';
SET LOCAL search_path = public, extensions;

DROP MATERIALIZED VIEW public.inventory_grouped_mv;
CREATE MATERIALIZED VIEW public.inventory_grouped_mv AS
 WITH normas AS MATERIALIZED (
         -- 3,308 descripciones distintas contra 13,750 grupos (2026-11-04):
         -- normalizar cada una UNA vez es 4× menos llamadas a norm_search.
         SELECT x.descripcion AS d, public.norm_search(x.descripcion) AS norm
           FROM (SELECT DISTINCT inventory.descripcion FROM public.inventory WHERE inventory.descripcion IS NOT NULL) x
        )
 SELECT g.erp_sucursal_id,
    g.erp_product_id,
    g.descripcion,
    coalesce(n.norm, public.norm_search(g.descripcion)) AS descripcion_norm,
    g.presentaciones,
    g.num_lotes,
    g.lote_sample,
    g.total_unidades,
    g.earliest_venc,
    g.soonest_active_venc,
    g.es_antibiotico,
    g.laboratorio_id,
    g.tipo_medicamento,
    g.total_costo,
    g.vencidos_unidades
   FROM (
WITH costs AS (
         SELECT DISTINCT ON (pp.product_id, pres.tipo) pp.product_id,
            pres.tipo,
            pp.costo
           FROM product_precios pp
             JOIN presentaciones pres ON pres.id = pp.id_presentacion
          WHERE pp.activo = true
          ORDER BY pp.product_id, pres.tipo, pp.updated_at DESC
        )
 SELECT i.erp_sucursal_id::integer AS erp_sucursal_id,
    i.erp_product_id,
    max(i.descripcion) AS descripcion,
    array_remove(array_agg(DISTINCT i.presentacion) FILTER (WHERE NOT i.is_vencidos AND (i.cantidad * COALESCE(NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text)::integer, 1)) > 0), NULL::text) AS presentaciones,
    count(DISTINCT NULLIF(i.lote, ''::text)) FILTER (WHERE NOT i.is_vencidos) AS num_lotes,
        CASE
            WHEN count(DISTINCT NULLIF(i.lote, ''::text)) FILTER (WHERE NOT i.is_vencidos) = 1 THEN min(NULLIF(i.lote, ''::text)) FILTER (WHERE NOT i.is_vencidos)
            ELSE NULL::text
        END AS lote_sample,
    COALESCE(sum(i.cantidad::numeric * COALESCE(NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text)::numeric, 1::numeric)) FILTER (WHERE NOT i.is_vencidos), 0::numeric) AS total_unidades,
    min(i.fecha_vencimiento) FILTER (WHERE i.fecha_vencimiento IS NOT NULL AND NOT i.is_vencidos) AS earliest_venc,
    min(i.fecha_vencimiento) FILTER (WHERE i.fecha_vencimiento IS NOT NULL AND i.fecha_vencimiento >= CURRENT_DATE AND NOT i.is_vencidos) AS soonest_active_venc,
    COALESCE(bool_or(p.es_antibiotico), false) AS es_antibiotico,
    p.laboratorio_id,
    p.tipo_medicamento,
    COALESCE(sum(i.cantidad::numeric * c.costo::numeric) FILTER (WHERE NOT i.is_vencidos), 0::numeric) AS total_costo,
    COALESCE(sum(i.cantidad::numeric * COALESCE(NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text)::numeric, 1::numeric)) FILTER (WHERE i.is_vencidos), 0::numeric) AS vencidos_unidades
   FROM inventory i
     LEFT JOIN products p ON p.id = i.erp_product_id
     LEFT JOIN costs c ON c.product_id = i.erp_product_id AND c.tipo = TRIM(BOTH FROM i.presentacion)
  GROUP BY i.erp_sucursal_id, i.erp_product_id, p.laboratorio_id, p.tipo_medicamento
        ) g
     LEFT JOIN normas n ON n.d = g.descripcion;
CREATE UNIQUE INDEX uq_igmv ON public.inventory_grouped_mv USING btree (erp_sucursal_id, erp_product_id);
CREATE INDEX idx_igmv_sucursal ON public.inventory_grouped_mv USING btree (erp_sucursal_id);
CREATE INDEX idx_igmv_lab ON public.inventory_grouped_mv USING btree (laboratorio_id) WHERE (laboratorio_id IS NOT NULL);
CREATE INDEX idx_igmv_cat ON public.inventory_grouped_mv USING btree (tipo_medicamento) WHERE (tipo_medicamento IS NOT NULL);
CREATE INDEX idx_igmv_venc ON public.inventory_grouped_mv USING btree (earliest_venc) WHERE (earliest_venc IS NOT NULL);
CREATE INDEX idx_igmv_proximos ON public.inventory_grouped_mv USING btree (soonest_active_venc) WHERE (soonest_active_venc IS NOT NULL);
CREATE INDEX idx_igmv_desc_trgm ON public.inventory_grouped_mv USING gin (descripcion public.gin_trgm_ops);
CREATE INDEX idx_igmv_desc_norm_trgm ON public.inventory_grouped_mv USING gin (descripcion_norm public.gin_trgm_ops);
REVOKE ALL ON public.inventory_grouped_mv FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.inventory_grouped_mv TO service_role;
