SET lock_timeout = '5s';

-- «Receta Médica» en Ventas: el filtro se resuelve en la base, no en el navegador.
--
-- Antes el portal pedía la lista de facturas que llevan un producto bajo receta
-- —`sales_invoice_items` filtrado por `erp_product_id`— y la reinyectaba como
-- `.in('id', …)` en la consulta de la lista y en la de los totales. Dos fallas:
--
--   1. Esa consulta no paginaba, y PostgREST corta en 1000 filas sin avisar.
--      Contra 4,013 renglones reales el navegador veía 901 facturas de 3,655:
--      agosto/2026 mostraba 8 ventas de las 93 que tienen receta.
--   2. No llevaba rango de fechas: barría toda la historia y después cruzaba
--      contra el mes en pantalla, así que el recorte caía repartido por meses
--      que ni se estaban mirando.
--
-- Traer la lista completa tampoco alcanzaba: con «Este año» son ~1,700 ids, y
-- esos ids viajan DENTRO de la URL del `.in()`. La lista correcta rompía la
-- consulta por otro lado. Por eso el filtro baja a la base, que es donde el
-- conjunto no tiene que caber en ningún lado.
--
-- Las dos funciones son gemelas a propósito: `get_ventas_con_receta` dibuja la
-- lista y `get_ventas_receta_stats` los totales del encabezado, y comparten el
-- mismo bloque `base`. Si divergen, el encabezado deja de describir la lista.
--
-- ⚠️ Las tres migraciones que siguen a ésta corrigen el PLAN, no el resultado.
-- Leer 20260817175559, 20260817175740 y 20260817175834 antes de tocar nada acá.

-- ---------------------------------------------------------------------------
-- La lista paginada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ventas_con_receta(
    p_fini      date,
    p_ffin      date,
    p_branch_id bigint  DEFAULT NULL,
    -- 'todas' | 'solo' | 'excluir'. No es un booleano porque son TRES estados:
    -- la lista las mezcla, el chip «Anuladas» las aísla, y los totales las
    -- descuentan. Es exactamente lo que hacía el cliente antes de este cambio.
    p_anuladas  text    DEFAULT 'todas',
    p_search    text    DEFAULT NULL,
    p_sort_col  text    DEFAULT 'fecha',
    p_sort_dir  text    DEFAULT 'DESC',
    p_limit     integer DEFAULT 50,
    p_offset    integer DEFAULT 0
)
RETURNS TABLE(
    id bigint, branch_id bigint, erp_invoice_id text, correlativo text,
    tipo_documento text, fecha date, hora time without time zone, cliente text,
    cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric,
    retencion numeric, total numeric, estado text, recibido_mh text,
    has_puntos boolean
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
    v_sort_col text;
    v_sort_dir text;
    v_sql      text;
BEGIN
    IF p_anuladas NOT IN ('todas', 'solo', 'excluir') THEN
        RAISE EXCEPTION 'p_anuladas invalido: % (esperado todas|solo|excluir)', p_anuladas;
    END IF;

    -- Whitelist: es lo ÚNICO que se concatena al SQL. Las claves son las de la
    -- tabla en pantalla, que no coinciden con los nombres de las columnas.
    v_sort_col := CASE p_sort_col
        WHEN 'fecha'          THEN 'si.fecha'
        WHEN 'id'             THEN 'si.id'
        WHEN 'tipo'           THEN 'si.tipo_documento'
        WHEN 'sucursal'       THEN 'si.branch_id'
        WHEN 'vendedor'       THEN 'si.cod_vendedor'
        WHEN 'cliente'        THEN 'si.cliente'
        WHEN 'metodo'         THEN 'si.tipo_pago'
        WHEN 'total'          THEN 'si.total'
        -- los nombres reales de columna también se aceptan
        WHEN 'correlativo'    THEN 'si.correlativo'
        WHEN 'tipo_documento' THEN 'si.tipo_documento'
        WHEN 'branch_id'      THEN 'si.branch_id'
        WHEN 'cod_vendedor'   THEN 'si.cod_vendedor'
        WHEN 'tipo_pago'      THEN 'si.tipo_pago'
        ELSE 'si.fecha'
    END;
    v_sort_dir := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

    v_sql := '
      WITH base AS (
        SELECT si.*
          FROM public.sales_invoices si
         WHERE si.fecha BETWEEN $1 AND $2
           AND ($3::bigint IS NULL OR si.branch_id = $3::bigint)
           AND ($4 <> ''excluir'' OR si.estado NOT IN (''NULA'', ''DTE INVALIDADO EN MH''))
           AND ($4 <> ''solo''    OR si.estado     IN (''NULA'', ''DTE INVALIDADO EN MH''))
           AND ($5::text IS NULL OR si.id IN (
                 SELECT s.id FROM public.search_ventas_ids($5, $1, $2) s))
           AND EXISTS (
                 SELECT 1
                   FROM public.sales_invoice_items ii
                  WHERE ii.invoice_id = si.id
                    AND ii.erp_product_id IN (
                          SELECT pr.id FROM public.products pr WHERE pr.es_antibiotico))
      )
      SELECT si.id, si.branch_id, si.erp_invoice_id, si.correlativo,
             si.tipo_documento, si.fecha, si.hora, si.cliente,
             si.cod_vendedor, si.tipo_pago, si.subtotal, si.iva,
             si.retencion, si.total, si.estado, si.recibido_mh, si.has_puntos
        FROM base si
       ORDER BY ' || v_sort_col || ' ' || v_sort_dir || ', si.fecha DESC, si.hora DESC LIMIT $6 OFFSET $7';

    RETURN QUERY EXECUTE v_sql
        USING p_fini, p_ffin, p_branch_id, p_anuladas, p_search, p_limit, p_offset;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Los totales del encabezado, sobre EXACTAMENTE el mismo conjunto.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ventas_receta_stats(
    p_fini      date,
    p_ffin      date,
    p_branch_id bigint DEFAULT NULL,
    p_anuladas  text   DEFAULT 'excluir',
    p_search    text   DEFAULT NULL
)
RETURNS TABLE(total_count bigint, total_sum numeric, total_puntos numeric)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  WITH base AS (
    SELECT si.id, si.total
      FROM public.sales_invoices si
     WHERE si.fecha BETWEEN p_fini AND p_ffin
       AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
       AND (p_anuladas <> 'excluir' OR si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH'))
       AND (p_anuladas <> 'solo'    OR si.estado     IN ('NULA', 'DTE INVALIDADO EN MH'))
       AND (p_search IS NULL OR si.id IN (
             SELECT s.id FROM public.search_ventas_ids(p_search, p_fini, p_ffin) s))
       AND EXISTS (
             SELECT 1
               FROM public.sales_invoice_items ii
              WHERE ii.invoice_id = si.id
                AND ii.erp_product_id IN (
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
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_con_receta(date, date, bigint, text, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ventas_con_receta(date, date, bigint, text, text, text, text, integer, integer) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text) TO authenticated, service_role;
