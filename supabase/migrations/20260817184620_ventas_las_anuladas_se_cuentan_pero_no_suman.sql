SET lock_timeout = '5s';

-- El encabezado de Ventas describía una lista distinta de la que se veía.
--
-- La lista SIEMPRE mostró las ventas anuladas, y bien: van tachadas, con fondo
-- rojo y el rótulo ANULADA. Pero el conteo del encabezado las descontaba. En
-- agosto/2026 la lista traía 11,426 ventas y la tarjeta «Facturas» decía
-- 11,395: 31 filas que se podían recorrer con el dedo y no estaban en el total.
-- Nadie lo notaba porque son el 0.3%.
--
-- La regla, decidida el 2026-08-17: **las anuladas se cuentan, no se suman.**
-- Una anulada ocurrió —es un documento, ocupa un renglón, se puede abrir— así
-- que entra en «Facturas». Lo que no ocurrió es la venta, así que no entra en
-- «Total ventas» ni en el ticket promedio ni en los puntos.
--
-- De ahí que ahora sean DOS conteos y no uno:
--
--   total_count_todas  cuántos renglones tiene la lista   → tarjeta «Facturas»
--   total_count        cuántos de esos suman dinero       → divisor del ticket
--   total_sum          el dinero                          → tarjeta «Total ventas»
--
-- `total_count` conserva su significado viejo (sin anuladas) a propósito: lo lee
-- también la pestaña de Vendedores, donde el ranking se hace sobre ventas
-- efectivas. Se AGREGA una columna, no se cambia ninguna.

DROP FUNCTION IF EXISTS public.get_ventas_stats(date, date, integer, time without time zone);

CREATE FUNCTION public.get_ventas_stats(
    p_fini date,
    p_ffin date,
    p_branch_id integer DEFAULT NULL::integer,
    p_hora_corte time without time zone DEFAULT NULL::time without time zone)
RETURNS TABLE(total_count bigint, total_sum numeric, total_count_todas bigint)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
WITH
-- Earliest date in sales_daily_stats for this branch (NULL = table empty)
coverage AS (
    SELECT MIN(date) AS since
    FROM public.sales_daily_stats
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Past days covered by daily_stats (fast path)
from_stats AS (
    SELECT
        COALESCE(SUM(count_valid), 0)::bigint AS cnt,
        COALESCE(SUM(sum_total), 0)           AS total
    FROM public.sales_daily_stats
    WHERE date >= GREATEST(p_fini, COALESCE((SELECT since FROM coverage), CURRENT_DATE))
      AND date < CURRENT_DATE
      AND date <= p_ffin
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Raw scan for dates before daily_stats coverage (bootstrap fallback).
from_raw AS (
    SELECT
        COUNT(*)::bigint                 AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE fecha >= p_fini
      AND fecha <  LEAST(COALESCE((SELECT since FROM coverage), CURRENT_DATE), CURRENT_DATE)
      AND fecha <= p_ffin
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Today from raw tables (always live, supports hora_corte)
live AS (
    SELECT
        COUNT(*)                         AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE p_ffin >= CURRENT_DATE
      AND fecha  >= GREATEST(p_fini, CURRENT_DATE)
      AND (fecha < p_ffin OR (fecha = p_ffin AND (p_hora_corte IS NULL OR hora <= p_hora_corte)))
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Las anuladas del MISMO rango. Van aparte y no dentro de los tres bloques de
-- arriba porque el pre-agregado `sales_daily_stats` sólo guarda `count_valid`:
-- no sabe cuántas se anularon. Contarlas en vivo cuesta un Index Only Scan del
-- mes (12 ms medidos sobre 11,430 filas) y evita tener que agregarle una
-- columna al pre-agregado y rellenar la historia.
--
-- La condición de la hora replica la de `live`: el corte sólo recorta el ÚLTIMO
-- día y sólo si ese día es hoy. Para un día ya pasado entran todas.
anuladas AS (
    SELECT COUNT(*)::bigint AS cnt
    FROM public.sales_invoices
    WHERE fecha >= p_fini
      AND fecha <= p_ffin
      AND (fecha < p_ffin OR fecha < CURRENT_DATE
           OR p_hora_corte IS NULL OR hora <= p_hora_corte)
      AND estado IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
)
SELECT (s.cnt + r.cnt + l.cnt),
       (s.total + r.total + l.total),
       (s.cnt + r.cnt + l.cnt + a.cnt)
FROM from_stats s, from_raw r, live l, anuladas a;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_stats(date, date, integer, time without time zone) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ventas_stats(date, date, integer, time without time zone) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La gemela del filtro «Receta Médica», con la misma regla.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_ventas_receta_stats(date, date, bigint, text, text);

CREATE FUNCTION public.get_ventas_receta_stats(
    p_fini      date,
    p_ffin      date,
    p_branch_id bigint DEFAULT NULL,
    -- El ALCANCE de la lista, no un criterio de suma: 'todas' es lo que se ve
    -- por defecto y 'solo' es la píldora «Anuladas» encendida.
    p_anuladas  text   DEFAULT 'todas',
    p_search    text   DEFAULT NULL
)
RETURNS TABLE(total_count bigint, total_sum numeric, total_puntos numeric, total_count_todas bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
BEGIN
    IF p_anuladas NOT IN ('todas', 'solo', 'excluir') THEN
        RAISE EXCEPTION 'p_anuladas invalido: % (esperado todas|solo|excluir)', p_anuladas;
    END IF;

    RETURN QUERY
    -- `base` es EXACTAMENTE lo que dibuja get_ventas_con_receta con los mismos
    -- argumentos. Si las dos dejan de coincidir, el encabezado vuelve a hablar
    -- de una lista que no es la que está en pantalla.
    WITH base AS (
      SELECT si.id, si.total, si.estado
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
    -- Las que suman dinero. La excepción del alcance 'solo' es deliberada:
    -- cuando alguien enciende «Anuladas» está AUDITANDO las anuladas, y el
    -- número que quiere es cuánto se anuló. Dejarlo en $0 sería literal y
    -- también inútil.
    cuentan AS (
      SELECT b.id, b.total FROM base b
       WHERE p_anuladas = 'solo'
          OR b.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    ),
    -- Mismo criterio que get_puntos_canjeados: una factura puede traer varios
    -- renglones de canje y solo cuenta el mayor.
    puntos AS (
      SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
        FROM public.sales_invoice_items ii
       WHERE ii.erp_product_id = 0
         AND ii.invoice_id IN (SELECT c.id FROM cuentan c)
       ORDER BY ii.invoice_id, ii.total_linea DESC
    )
    SELECT (SELECT count(*) FROM cuentan)::bigint,
           (SELECT coalesce(sum(c.total), 0)        FROM cuentan c),
           (SELECT coalesce(sum(pt.total_linea), 0) FROM puntos pt),
           (SELECT count(*) FROM base)::bigint;
END;
$function$;

ALTER FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text)
    SET plan_cache_mode = 'force_custom_plan';

REVOKE EXECUTE ON FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text) TO authenticated, service_role;
