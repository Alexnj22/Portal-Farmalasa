-- «Con diferencia» lista los productos que de verdad no cuadran.
--
-- Bodega, reconteo (2026-11-27): «¿por qué al darle en con diferencia me
-- salen 1186 productos?». La tarjeta decía 184. El filtro marcaba un producto
-- en cuanto UN renglón tenía diferencia, y en un conteo por lote casi todo
-- producto la tiene: lo que el sistema tenía «sin lote» se contó en sus lotes
-- reales (−3 en «Sin lote», +3 en el lote impreso). El producto cuadra y al
-- aprobar sólo pasa de un lote al otro (`renglones_reacomodo`). Medido en el
-- conteo de Bodega: 1,258 grupos con algún renglón distinto, 1,007 de ellos
-- sólo reacomodo.
--
-- Ahora el filtro exige además que el PRODUCTO no cuadre: su diferencia neta
-- en unidades base (`diferencia_total`, la misma suma que pinta la fila y que
-- `conteo_cifras_por_producto` usa para la tarjeta) distinta de cero. La
-- página y su contador cambian juntos, o la paginación diría otro número.
--
-- Desde la definición VIVA, reemplazando sólo lo necesario; si un texto no
-- aparece, la migración se cae.

SET lock_timeout = '5s';

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- 1. La página: ya calcula `diferencia_total` por producto.
  v_def := pg_get_functiondef('public.get_conteo_products_page'::regproc);
  v_new := replace(v_def,
    E'OR (v_filtro = ''DIFERENCIA'' AND o.con_diferencia_count > 0)',
    E'OR (v_filtro = ''DIFERENCIA'' AND o.con_diferencia_count > 0\n             -- El producto no cuadra; un reacomodo de lote sí cuadra (2026-11-27).\n             AND coalesce(o.diferencia_total, 0) <> 0)');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_page: no se encontró el filtro'; END IF;
  EXECUTE v_new;

  -- 2. El contador: la misma suma, con el mismo multiplicador que la página.
  v_def := pg_get_functiondef('public.get_conteo_products_count'::regproc);
  v_new := replace(v_def,
    E'           nt.neto_grupo\n    FROM public.conteo_inventario_items ci',
    E'           nt.neto_grupo,\n'
    || E'           -- Igual que `mult_prod` en la página: unidades base si el producto\n'
    || E'           -- mezcla presentaciones de un mismo lote.\n'
    || E'           CASE WHEN bool_or(coalesce(nt.grupo_mixto, false)) OVER (PARTITION BY ci.erp_product_id)\n'
    || E'                THEN coalesce(nt.factor, 1) ELSE 1 END AS mult_prod\n'
    || E'    FROM public.conteo_inventario_items ci');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_count: no se encontró la base'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'           count(*) FILTER (WHERE b.estado_item = ''SIN_UBICAR'') AS sin_ubicar_count\n    FROM base b',
    E'           count(*) FILTER (WHERE b.estado_item = ''SIN_UBICAR'') AS sin_ubicar_count,\n'
    || E'           sum(b.diferencia * b.mult_prod) AS diferencia_total\n    FROM base b');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_count: no se encontró per_product'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'OR (cfg.filtro = ''DIFERENCIA'' AND per_product.con_diferencia_count > 0)',
    E'OR (cfg.filtro = ''DIFERENCIA'' AND per_product.con_diferencia_count > 0\n              AND coalesce(per_product.diferencia_total, 0) <> 0)');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_count: no se encontró el filtro'; END IF;
  EXECUTE v_new;
END
$mig$;
