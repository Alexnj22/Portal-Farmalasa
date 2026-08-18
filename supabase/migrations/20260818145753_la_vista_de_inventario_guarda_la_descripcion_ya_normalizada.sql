SET lock_timeout = '5s';

-- La búsqueda de la vista Inventario normalizaba fila por fila, y dos veces.
--
-- `inventory_grouped` filtra con `norm_search(m.descripcion) LIKE ALL (...)`.
-- `norm_search` es `unaccent` + `regexp_replace`, o sea ~25 µs por fila, y la
-- vista tiene 13,809 filas: **342 ms sólo en normalizar**, para que pasen 38.
-- Y la función lo hace DOS veces —una para el COUNT y otra para el SELECT—, así
-- que la pantalla costaba 720 ms con búsqueda contra 19 ms sin ella. Ningún
-- índice podía intervenir: `LIKE ALL (array)` es un ScalarArrayOp y no hay
-- índice que lo resuelva.
--
-- Se probó primero el camino sin DDL: agregar `LIKE v_pats[1]` como prefiltro
-- para despertar el índice trigram que ya existía. Anda muy bien y tiene un
-- acantilado — medido: «amox» 353.8 → 2.3 ms, «acetaminofen 500» 341.7 → 18.8
-- ms, pero «mg» 348.5 → **432.3 ms** y «ac» 350.8 → 366.9 ms, porque un índice
-- trigram no puede con patrones de dos letras y encima se paga el predicado de
-- más. Un remedio que empeora justo las búsquedas cortas no sirve.
--
-- Guardar la columna ya normalizada da **5.2 ms parejos**, sin acantilado y sin
-- depender de cuántas letras se escribieron. Medido sobre una copia: filas
-- idénticas (38 = 38 con una palabra, 14 = 14 con dos).
--
-- Se intercambia por RENOMBRE y no con DROP + CREATE: construir la vista nueva
-- no toca la vieja, y el cambio de nombre es una operación de catálogo. Así el
-- bloqueo exclusivo dura microsegundos en vez de toda la construcción — que es
-- exactamente la diferencia que causó el corte del 2026-07-08.
--
-- Verificado tras aplicar: 13,775 filas, CERO en las que `descripcion_norm`
-- difiera de `norm_search(descripcion)`, cero nulos, el REFRESH CONCURRENTLY
-- sigue funcionando, la ACL quedó igual (sólo postgres y service_role) y el
-- advisor de seguridad sigue en 0 errores.
CREATE MATERIALIZED VIEW public.inventory_grouped_mv_nueva AS
 WITH costs AS (
         SELECT DISTINCT ON (pp.product_id, pres.tipo) pp.product_id,
            pres.tipo,
            pp.costo
           FROM (product_precios pp
             JOIN presentaciones pres ON ((pres.id = pp.id_presentacion)))
          WHERE (pp.activo = true)
          ORDER BY pp.product_id, pres.tipo, pp.updated_at DESC
        )
 SELECT (i.erp_sucursal_id)::integer AS erp_sucursal_id,
    i.erp_product_id,
    max(i.descripcion) AS descripcion,
    -- La misma descripción que ya se guardaba, normalizada UNA vez al refrescar
    -- en vez de 13,809 veces por búsqueda.
    public.norm_search(max(i.descripcion)) AS descripcion_norm,
    array_remove(array_agg(DISTINCT i.presentacion) FILTER (WHERE ((NOT i.is_vencidos) AND ((i.cantidad * COALESCE((NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text))::integer, 1)) > 0))), NULL::text) AS presentaciones,
    count(DISTINCT NULLIF(i.lote, ''::text)) FILTER (WHERE (NOT i.is_vencidos)) AS num_lotes,
        CASE
            WHEN (count(DISTINCT NULLIF(i.lote, ''::text)) FILTER (WHERE (NOT i.is_vencidos)) = 1) THEN min(NULLIF(i.lote, ''::text)) FILTER (WHERE (NOT i.is_vencidos))
            ELSE NULL::text
        END AS lote_sample,
    COALESCE(sum(((i.cantidad)::numeric * COALESCE((NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text))::numeric, (1)::numeric))) FILTER (WHERE (NOT i.is_vencidos)), (0)::numeric) AS total_unidades,
    min(i.fecha_vencimiento) FILTER (WHERE ((i.fecha_vencimiento IS NOT NULL) AND (NOT i.is_vencidos))) AS earliest_venc,
    min(i.fecha_vencimiento) FILTER (WHERE ((i.fecha_vencimiento IS NOT NULL) AND (i.fecha_vencimiento >= CURRENT_DATE) AND (NOT i.is_vencidos))) AS soonest_active_venc,
    COALESCE(bool_or(p.es_antibiotico), false) AS es_antibiotico,
    p.laboratorio_id,
    p.tipo_medicamento,
    COALESCE(sum(((i.cantidad)::numeric * (c.costo)::numeric)) FILTER (WHERE (NOT i.is_vencidos)), (0)::numeric) AS total_costo,
    COALESCE(sum(((i.cantidad)::numeric * COALESCE((NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text))::numeric, (1)::numeric))) FILTER (WHERE i.is_vencidos), (0)::numeric) AS vencidos_unidades
   FROM ((inventory i
     LEFT JOIN products p ON ((p.id = i.erp_product_id)))
     LEFT JOIN costs c ON (((c.product_id = i.erp_product_id) AND (c.tipo = TRIM(BOTH FROM i.presentacion)))))
  GROUP BY i.erp_sucursal_id, i.erp_product_id, p.laboratorio_id, p.tipo_medicamento;

-- El índice único es lo que habilita `REFRESH ... CONCURRENTLY`. Sin él, cada
-- refresco pasaría a bloquear la vista entera.
CREATE UNIQUE INDEX uq_igmv_nueva            ON public.inventory_grouped_mv_nueva (erp_sucursal_id, erp_product_id);
CREATE INDEX idx_igmv_sucursal_nueva         ON public.inventory_grouped_mv_nueva (erp_sucursal_id);
CREATE INDEX idx_igmv_lab_nueva              ON public.inventory_grouped_mv_nueva (laboratorio_id)      WHERE laboratorio_id IS NOT NULL;
CREATE INDEX idx_igmv_cat_nueva              ON public.inventory_grouped_mv_nueva (tipo_medicamento)    WHERE tipo_medicamento IS NOT NULL;
CREATE INDEX idx_igmv_venc_nueva             ON public.inventory_grouped_mv_nueva (earliest_venc)       WHERE earliest_venc IS NOT NULL;
CREATE INDEX idx_igmv_proximos_nueva         ON public.inventory_grouped_mv_nueva (soonest_active_venc) WHERE soonest_active_venc IS NOT NULL;
CREATE INDEX idx_igmv_desc_trgm_nueva        ON public.inventory_grouped_mv_nueva USING gin (descripcion gin_trgm_ops);
-- Sobre la COLUMNA, ya no sobre la expresión: el índice de antes era
-- `gin (norm_search(descripcion))` y obligaba a recalcularla para usarlo.
CREATE INDEX idx_igmv_desc_norm_trgm_nueva   ON public.inventory_grouped_mv_nueva USING gin (descripcion_norm gin_trgm_ops);

ANALYZE public.inventory_grouped_mv_nueva;

-- El intercambio. A partir de acá se toma el bloqueo exclusivo, y son tres
-- operaciones de catálogo hasta el commit.
ALTER MATERIALIZED VIEW public.inventory_grouped_mv       RENAME TO inventory_grouped_mv_vieja;
ALTER MATERIALIZED VIEW public.inventory_grouped_mv_nueva RENAME TO inventory_grouped_mv;
DROP MATERIALIZED VIEW public.inventory_grouped_mv_vieja;

-- Los nombres canónicos vuelven a su sitio (los viejos se fueron con el DROP).
ALTER INDEX public.uq_igmv_nueva                 RENAME TO uq_igmv;
ALTER INDEX public.idx_igmv_sucursal_nueva      RENAME TO idx_igmv_sucursal;
ALTER INDEX public.idx_igmv_lab_nueva           RENAME TO idx_igmv_lab;
ALTER INDEX public.idx_igmv_cat_nueva           RENAME TO idx_igmv_cat;
ALTER INDEX public.idx_igmv_venc_nueva          RENAME TO idx_igmv_venc;
ALTER INDEX public.idx_igmv_proximos_nueva      RENAME TO idx_igmv_proximos;
ALTER INDEX public.idx_igmv_desc_trgm_nueva     RENAME TO idx_igmv_desc_trgm;
ALTER INDEX public.idx_igmv_desc_norm_trgm_nueva RENAME TO idx_igmv_desc_norm_trgm;

-- Las mismas de antes: la vista NO se expone a la API (regla 6 de CLAUDE.md).
-- Se llega sólo por las RPC, que son DEFINER.
REVOKE ALL ON public.inventory_grouped_mv FROM PUBLIC, anon, authenticated;
GRANT ALL  ON public.inventory_grouped_mv TO service_role;
