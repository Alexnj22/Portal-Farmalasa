-- Bloque 7B.2: resuelve la política de vencimiento/devolución aplicable a
-- un producto — regla (a) de Bodega: "primero laboratorio, luego viñeta del
-- proveedor". Antes no había forma automática de saber a qué proveedor
-- específico pertenece un producto cuando un laboratorio tiene varios
-- proveedores registrados (labs reales con 2-5 proveedores hoy) — proveedores
-- no tenía ninguna columna que lo permitiera. Decisión del usuario: agregar
-- proveedores.vineta y cruzarlo con product_precios.vineta (el precio-viñeta
-- vigente del producto) para desambiguar.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_product_vencimiento_policy(p_erp_product_id integer)
 RETURNS TABLE(
   proveedor_id integer,
   proveedor_nombre text,
   meses_devolucion integer,
   es_devolutivo boolean,
   es_cofarsal boolean,
   resolucion text
 )
 LANGUAGE sql
 STABLE
 SET search_path = public, extensions
AS $function$
  WITH prod AS (
    SELECT p.id, p.laboratorio_id, COALESCE(p.devolutivo, true) AS producto_devolutivo
    FROM products p WHERE p.id = p_erp_product_id
  ),
  candidatos AS (
    SELECT pv.id, pv.nombre, pv.meses_devolucion, pv.devolutivo, pv.vineta
    FROM proveedores pv JOIN prod ON prod.laboratorio_id = pv.laboratorio_id
  ),
  -- Match preciso: la viñeta del proveedor coincide con la viñeta vigente
  -- del producto en product_precios (alguna presentación activa).
  por_vineta AS (
    SELECT c.*, 1 AS prioridad, 'vineta'::text AS metodo
    FROM candidatos c
    WHERE c.vineta IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM product_precios pp
        WHERE pp.product_id = p_erp_product_id AND pp.activo = true AND pp.vineta = c.vineta
      )
  ),
  -- Fallback: si el laboratorio tiene un solo proveedor registrado, no hace
  -- falta desambiguar por viñeta.
  unico AS (
    SELECT c.*, 2 AS prioridad, 'unico'::text AS metodo
    FROM candidatos c
    WHERE (SELECT count(*) FROM candidatos) = 1
  ),
  resuelto AS (
    SELECT * FROM por_vineta
    UNION ALL
    SELECT * FROM unico WHERE NOT EXISTS (SELECT 1 FROM por_vineta)
    ORDER BY prioridad, id
    LIMIT 1
  )
  SELECT
    r.id,
    r.nombre,
    r.meses_devolucion,
    -- ND a nivel de producto (products.devolutivo=false) es una excepción
    -- que manda sobre la política del proveedor, no al revés.
    (COALESCE(r.devolutivo, true) AND (SELECT producto_devolutivo FROM prod)),
    (r.nombre ~* 'cofarsal'),
    r.metodo
  FROM resuelto r;
$function$;

REVOKE ALL ON FUNCTION public.get_product_vencimiento_policy(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_vencimiento_policy(integer) TO authenticated, service_role;
