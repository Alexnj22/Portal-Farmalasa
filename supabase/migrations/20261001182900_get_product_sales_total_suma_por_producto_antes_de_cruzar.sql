-- get_product_sales_total (el total bajo Ventas › Productos) cruzaba CADA
-- renglón de ventas con `products` para descartar los ocultos. Como usuario
-- (con RLS) el planificador estimaba 5,869 filas donde venían 111,068 y elegía
-- un Nested Loop con una búsqueda por renglón: con un año de rango, 333,210
-- de sus 336,868 bloques (2.6 GB, 383 ms). Medido el 2026-10-01 con la sesión
-- de un cargo de dirección; como administrador de la base —sin RLS— eran
-- 5,384 y no se veía.
--
-- Ahora se suma primero por producto (~5 mil filas) y recién después se
-- descartan los ocultos. Mismo resultado al último decimal en cinco casos (un
-- año, un mes, bordes parciales, con y sin sala). Un año pasa a 15,151
-- bloques (−95%) y 267 ms.
--
-- Parte de la definición VIVA y cambia sólo el cruce final; si ese texto no
-- está tal cual, falla en vez de no hacer nada.
SET lock_timeout = '5s';
DO $$
DECLARE
  v_antes text := pg_get_functiondef('public.get_product_sales_total'::regproc);
  v_despues text;
BEGIN
  v_despues := replace(v_antes,
    E'SELECT COALESCE(SUM(s.neto), 0)\nFROM src s\nLEFT JOIN public.products p ON p.id = s.erp_product_id',
    E'SELECT COALESCE(SUM(s.neto), 0)\nFROM (SELECT erp_product_id, SUM(neto) AS neto FROM src GROUP BY erp_product_id) s\nLEFT JOIN public.products p ON p.id = s.erp_product_id');
  IF v_despues = v_antes THEN
    RAISE EXCEPTION 'get_product_sales_total: no encontré el cruce final a reemplazar (¿cambió la función?)';
  END IF;
  EXECUTE v_despues;
END $$;
