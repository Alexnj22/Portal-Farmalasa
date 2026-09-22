-- docs/PLAN-FACTOR-Y-MINMAX-2026-08-13.md, opción (A) — decisión del usuario 2026-09-22.
--
-- El usuario corrigió en el sistema de la caja el TEXTO de presentación de 24
-- renglones («1X 16» → «1X16», «1X1» → «1X10»…) para que el regex del trigger
-- `fn_set_item_factor_unidades` lea lo mismo que el factor del catálogo. Las
-- ventas nuevas ya entran bien; las VIEJAS guardan el texto de entonces, y su
-- `factor_unidades` quedó congelado mal.
--
-- Acá esas líneas toman el factor del catálogo, cruzando por producto +
-- presentación (la presentación es el prefijo del texto de la línea: «CAJA 1X 16»).
-- Medido antes de aplicar: 236 líneas en 10 productos. Sólo cambia
-- `factor_unidades`, que es derivada del portal; `cantidad` y `total_linea`
-- (fiscales) no se tocan. El trigger es `BEFORE ... UPDATE OF presentacion`, así
-- que esta escritura no lo dispara.
--
-- El MIN·MAX NO se recalcula acá: lo toma el recálculo mensual del 1-oct
-- (decisión del usuario — recalcular hoy dejaba ~7,300 borradores por revisar).

SET lock_timeout = '5s';

WITH cat AS (
  SELECT pp.product_id, pr.tipo, pp.factor
    FROM public.product_precios pp
    JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
   WHERE pp.activo AND pp.factor > 0
     AND pp.product_id IN (987,3827,3862,3939,4127,4244,4314,4324,4673,5036)
),
correcto AS (
  SELECT ii.id, max(c.factor) AS factor, count(DISTINCT c.factor) AS opciones
    FROM public.sales_invoice_items ii
    JOIN cat c ON c.product_id = ii.erp_product_id AND ii.presentacion LIKE c.tipo || ' %'
   WHERE NOT EXISTS (SELECT 1 FROM cat c2
                      WHERE c2.product_id = c.product_id AND length(c2.tipo) > length(c.tipo)
                        AND ii.presentacion LIKE c2.tipo || ' %')
   GROUP BY ii.id
)
UPDATE public.sales_invoice_items ii
   SET factor_unidades = co.factor
  FROM correcto co
 WHERE ii.id = co.id AND co.opciones = 1
   AND ii.factor_unidades IS DISTINCT FROM co.factor;
