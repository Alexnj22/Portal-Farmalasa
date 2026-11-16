-- conteo_inventario_items da SELECT a `authenticated` columna por columna (no
-- a la tabla). Las tres columnas de 20261116175431 nacieron sin ese permiso, y
-- las funciones INVOKER que las leen (get_conteo_items_search,
-- get_conteo_products_page, get_conteo_items_jsonb) fallaban con «permission
-- denied»: la pantalla del conteo dejó de cargar. Ninguna de las tres es
-- sensible (lote y vencimiento originales de la existencia).
SET lock_timeout = '5s';
GRANT SELECT (etiqueta_corregida, lote_sistema, vence_sistema)
  ON public.conteo_inventario_items TO authenticated;
