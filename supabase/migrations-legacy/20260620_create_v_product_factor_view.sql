-- Vista centralizada: (product_id, presentacion_text) → factor oficial desde product_precios.
-- Join key: UPPER(TRIM(inventory.presentacion)) = v_product_factor.pres_key
-- Todas las funciones de inventario deben usar esta vista en vez de parsear inventory.detalle.
-- Si no hay match (presentacion no existe en catálogo), se cae al fallback del split('x').

CREATE OR REPLACE VIEW public.v_product_factor AS
SELECT DISTINCT ON (pp.product_id, UPPER(TRIM(pr.tipo)))
  pp.product_id,
  UPPER(TRIM(pr.tipo))  AS pres_key,      -- match con UPPER(TRIM(inventory.presentacion))
  pp.factor,
  pp.id_presentacion,
  pr.tipo               AS pres_tipo
FROM product_precios pp
JOIN presentaciones pr ON pr.id = pp.id_presentacion
WHERE pp.activo = true
  AND pp.factor > 0
ORDER BY pp.product_id, UPPER(TRIM(pr.tipo)), pp.factor DESC;

COMMENT ON VIEW public.v_product_factor IS
  'Factor oficial por (product_id, presentacion). JOIN: vf.product_id = erp_product_id AND vf.pres_key = UPPER(TRIM(inventory.presentacion))';

GRANT SELECT ON public.v_product_factor TO authenticated, service_role;
