SET lock_timeout = '5s';

-- Mismo cuerpo, otro lenguaje. `get_ventas_receta_stats` era LANGUAGE sql y una
-- función sql de un solo SELECT se INLINEA en la consulta que la llama: sus CTE
-- se aplanan y el planificador vuelve a elegir entrar por las facturas, que es
-- justo lo que la migración anterior evitó. Medido en el rango de un año:
--
--   LANGUAGE sql (inlineada)      1,011 ms   1,461,025 búferes
--   el MISMO cuerpo con PREPARE      34 ms      15,911 búferes
--
-- O sea que el cuerpo ya estaba bien y el envase lo arruinaba. plpgsql no se
-- inlinea nunca, así que el bloque se planifica solo, con `base` materializado
-- —lo está por ser referenciado tres veces— y el semi-join entrando por los
-- 4,013 renglones. Es el mismo motivo por el que `get_ventas_con_puntos` es
-- plpgsql y no sql.
--
-- Regla para el que venga: este bloque NO se puede leer para saber si está
-- bien. Se mide, y con `TIMING OFF` — con el timing encendido la instrumentación
-- de las 3,655 vueltas del nested loop inventa un segundo que no existe.

CREATE OR REPLACE FUNCTION public.get_ventas_receta_stats(
    p_fini      date,
    p_ffin      date,
    p_branch_id bigint DEFAULT NULL,
    p_anuladas  text   DEFAULT 'excluir',
    p_search    text   DEFAULT NULL
)
RETURNS TABLE(total_count bigint, total_sum numeric, total_puntos numeric)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
BEGIN
    IF p_anuladas NOT IN ('todas', 'solo', 'excluir') THEN
        RAISE EXCEPTION 'p_anuladas invalido: % (esperado todas|solo|excluir)', p_anuladas;
    END IF;

    RETURN QUERY
    WITH base AS (
      SELECT si.id, si.total
        FROM public.sales_invoices si
       WHERE si.fecha BETWEEN p_fini AND p_ffin
         AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
         AND (p_anuladas <> 'excluir' OR si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH'))
         AND (p_anuladas <> 'solo'    OR si.estado     IN ('NULA', 'DTE INVALIDADO EN MH'))
         AND (p_search IS NULL OR si.id IN (
               SELECT s.id FROM public.search_ventas_ids(p_search, p_fini, p_ffin) s))
         AND si.id IN (
               SELECT ii.invoice_id
                 FROM public.sales_invoice_items ii
                WHERE ii.erp_product_id IN (
                      SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico))
    ),
    -- Mismo criterio que get_puntos_canjeados: una factura puede traer varios
    -- renglones de canje y solo cuenta el mayor.
    puntos AS (
      SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
        FROM public.sales_invoice_items ii
       WHERE ii.erp_product_id = 0
         AND ii.invoice_id IN (SELECT b.id FROM base b)
       ORDER BY ii.invoice_id, ii.total_linea DESC
    )
    SELECT (SELECT count(*) FROM base)::bigint,
           (SELECT coalesce(sum(b.total), 0)        FROM base b),
           (SELECT coalesce(sum(pt.total_linea), 0) FROM puntos pt);
END;
$function$;
