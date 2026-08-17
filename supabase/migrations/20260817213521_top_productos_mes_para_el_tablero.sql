SET lock_timeout = '5s';

-- El widget «Top productos» del tablero pinta DOS campos —nombre y monto— de
-- 10 productos, y hasta hoy los pedía a `get_product_sales_agg`, que arma 14
-- columnas para la pantalla de Ventas: presentaciones, costo por presentación
-- (un LATERAL con LIKE por fila contra product_precios), última venta por
-- sucursal, laboratorio y quién ocultó el producto. Con el `.limit(10)` de
-- PostgREST el recorte pasa AFUERA de la función: Postgres calculaba el mes
-- entero de las 7 salas y después tiraba todo menos 10 filas.
--
-- Medido el 2026-08-17 sobre 25 horas: 389 llamadas, 11,386 ms de promedio,
-- 74 s la peor — el 33% del tiempo total de la base. Este cuerpo: 55 ms.
--
-- No es una aproximación del número viejo. Con p_fini en el día 1 del mes en
-- curso —que es lo único que manda el tablero— las dos ramas históricas de
-- `get_product_sales_agg` (`pres_past` y `pres_partial`) quedan vacías por
-- construcción y sólo corre su rama viva, que es exactamente esto. Verificado
-- contra las 10 filas reales del 2026-08-01..17: mismo orden, mismas
-- descripciones, mismos montos al cuarto decimal.
--
-- El LIMIT va ADENTRO a propósito: es todo el punto del cambio. Y el agregado
-- va en una subconsulta para que `ORDER BY t.neto` quede calificado — sin eso
-- choca con la columna homónima del RETURNS TABLE, que en una función SQL
-- también está en alcance.
CREATE OR REPLACE FUNCTION public.get_top_productos_mes(
  p_fini   date,
  p_ffin   date,
  p_limite integer DEFAULT 10
)
RETURNS TABLE(erp_product_id integer, descripcion text, neto numeric)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path = public, extensions
AS $function$
  SELECT t.erp_product_id, t.descripcion, t.neto
  FROM (
    SELECT
      sii.erp_product_id         AS erp_product_id,
      MAX(sii.descripcion)::text AS descripcion,
      SUM(CASE WHEN si.tipo_documento = 'CCF'
               THEN sii.total_linea::numeric
               ELSE sii.total_linea::numeric / 1.13
          END)                   AS neto
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id <> 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha BETWEEN p_fini AND p_ffin
    GROUP BY sii.erp_product_id
  ) t
  ORDER BY t.neto DESC
  LIMIT GREATEST(COALESCE(p_limite, 10), 1);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_top_productos_mes(date, date, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_top_productos_mes(date, date, integer) TO authenticated, service_role;
