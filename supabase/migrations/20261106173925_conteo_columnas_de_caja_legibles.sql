SET lock_timeout = '5s';
-- La lista de conteos pide estas tres columnas (CONTEO_COLS en
-- src/data/conteoInventario.js). La tabla se lee por GRANT de columnas desde
-- 20260923 (valorizado sólo con permiso), y las tres nacieron el 2026-11-06 sin
-- su GRANT: el select entero fallaba con permission denied y la pantalla de
-- conteos quedaba vacía para todos — el conteo abierto de Salud 4 existía pero
-- no se veía, y crear otro chocaba con CONTEO_ABIERTO_EN_SUCURSAL.
GRANT SELECT (aplica_en_caja, caja_estado, caja_terminado_at)
  ON public.conteos_inventario TO authenticated;
