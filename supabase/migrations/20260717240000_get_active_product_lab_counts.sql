SET lock_timeout = '5s';

-- Deuda de rendimiento documentada en el /code-review de cierre de la
-- auditoría MinMax 2026-07-17: fetchActiveProductLabIds descargaba la
-- columna laboratorio_id de TODOS los productos activos (miles de filas, en
-- chunks paralelos de Patrón B) al cliente, solo para reducirlos a un conteo
-- por laboratorio en un .forEach() de JS. Reemplazado por un GROUP BY
-- server-side — el resultado son ~20-30 filas (una por laboratorio) en vez
-- de miles. Verificado en prod: 323 laboratorios, suma de counts = 4,354
-- productos, idéntico al conteo directo sobre products.
CREATE OR REPLACE FUNCTION public.get_active_product_lab_counts()
 RETURNS TABLE(laboratorio_id integer, product_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT laboratorio_id, count(*) AS product_count
  FROM products
  WHERE activo = true AND laboratorio_id IS NOT NULL
  GROUP BY laboratorio_id
$function$;

REVOKE ALL ON FUNCTION public.get_active_product_lab_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_product_lab_counts() TO authenticated, service_role;
