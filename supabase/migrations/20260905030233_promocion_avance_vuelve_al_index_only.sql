SET lock_timeout = '5s';

-- ── La MISMA reescritura ayuda a una hermana y perjudica a la otra ────────
--
-- La migración anterior invirtió la dirección del join en
-- `promocion_corte_del_lote` y en `promocion_avance`. En la primera fue una
-- mejora clara; en la segunda es una **regresión**, y la diferencia entre las
-- dos es UNA COLUMNA.
--
-- `promocion_avance` NO pide `cod_vendedor`, así que su `facturas` original
-- —(id, branch_id, fecha) filtrando por fecha y estado— la cubre entera
-- `idx_si_fecha_estado_branch (fecha, estado, branch_id, id)`: entra por
-- **Index Only Scan** y toca el heap 5,785 veces sobre 268,222 filas. Filtrar
-- por `si.id IN (items)` la obliga a buscar cada factura por clave primaria en
-- el heap, y pierde justo eso.
--
-- Medido sobre 12 meses y 12 productos, con SUS columnas:
--   · original (index-only): 4,911 bloques · 805 ms
--   · reescrita            : 7,098 bloques · 1,815 ms  ← 1.4× bloques, 2.3× más lenta
--
-- Es la regla que este repo ya tiene escrita —«dos formas correctas y cada una
-- gana en un caso; medir la reescritura en el caso GRANDE, no sólo en el
-- chico»— y sólo se vio por medirla. En el caso chico la reescrita parecía
-- ganar (31.6 → 12.1 ms), y el número que la delató fueron los BLOQUES, que
-- subieron de 3,574 a 4,165 mientras el reloj bajaba.
--
-- Vuelve a la versión original, tal cual estaba.

CREATE OR REPLACE FUNCTION public.promocion_avance(p_solo_abiertos boolean DEFAULT true)
 RETURNS TABLE(renglon_id bigint, branch_id bigint, vendido numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE NOT p_solo_abiertos
        OR (r.estado = 'abierto' AND pm.estado = 'activa');

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    -- ⚠️ SÓLO (id, branch_id, fecha) y SIN filtrar por los items: así entra por
    -- Index Only Scan sobre `idx_si_fecha_estado_branch`. Pedir una columna más
    -- —o acotar por `si.id IN (…)`— rompe el index-only y la deja 2.3× más
    -- lenta. Medido el 2026-09-05; ver el encabezado de esta migración.
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    )
    SELECT r.id, f.branch_id,
           sum(i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
      FROM items i
      JOIN facturas f ON f.id = i.invoice_id
      JOIN public.promocion_renglon r
        ON r.erp_product_id = i.erp_product_id
       AND f.fecha BETWEEN r.inicio AND r.fin
       AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE (NOT p_solo_abiertos OR (r.estado = 'abierto' AND pm.estado = 'activa'))
       AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                        WHERE v.invoice_id = f.id)
     GROUP BY r.id, f.branch_id;
END;
$function$;
