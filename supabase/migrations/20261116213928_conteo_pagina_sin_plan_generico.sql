-- El conteo tardaba 7 s desde la 6.ª consulta: plan genérico (2026-11-16).
--
-- «¿Pero carga lento? Se tarda en salirme el listado». Medido en la misma
-- conexión, como las reusa PostgREST: `get_conteo_products_page` tarda
-- 186 ms las primeras cinco veces y 6,725 ms desde la sexta (con búsqueda,
-- 297 → 1,681 ms). Es la regla de `docs/reglas/planes-de-funciones.md`:
-- plpgsql pasa al plan GENÉRICO en la sexta ejecución, y el plan bueno de ésta
-- depende de los argumentos (el conteo, la sucursal, la búsqueda). Era lo que
-- se veía en producción como llamadas de 5 a 29 s. `get_conteo_products_count`
-- ya llevaba la cláusula; ésta no.
--
-- Con la cláusula, ocho llamadas seguidas de `get_conteo_pagina`: 280–450 ms
-- todas. Replanificar cuesta ~5 ms contra una función de ~200 ms.
--
-- De paso, `get_conteo_items_search` con ids lee sólo el inventario de esos
-- productos (antes, el de toda la sucursal para cruzarlo con 20). Los cruces
-- son por producto, así que el resultado es el mismo.

SET lock_timeout = '5s';

ALTER FUNCTION public.get_conteo_products_page(uuid, text, text, integer, integer, integer, text, text, text)
  SET plan_cache_mode = 'force_custom_plan';

DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[], text)'::regprocedure);
  v_viejo text := $t$WHERE v_fuente = 'VIVO' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)$t$;
  v_nuevo text := $t$WHERE v_fuente = 'VIVO' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
      -- Sólo los productos pedidos: los cruces de abajo son por producto.
      AND (p_erp_product_id IS NULL OR i.erp_product_id = p_erp_product_id)
      AND (p_erp_product_ids IS NULL OR i.erp_product_id = ANY(p_erp_product_ids))$t$;
BEGIN
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE NOTICE 'get_conteo_items_search no tiene el texto esperado; se deja como está';
    RETURN;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END
$do$;
