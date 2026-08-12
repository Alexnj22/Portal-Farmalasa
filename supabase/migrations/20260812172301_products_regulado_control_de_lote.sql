SET lock_timeout = '5s';

-- ¿El producto lleva control de lote?
--
-- Sin este dato el portal no puede exigir el número de lote al cargar, y una
-- carga sin lote la rechaza el sistema de origen — con el agravante de que el
-- rechazo llega recién cuando el supervisor aprueba, sobre una solicitud que ya
-- nadie puede corregir.
--
-- No se puede deducir de nada que el portal ya tenga: `es_antibiotico` no
-- equivale (TYLEX 750 lleva lote y no es antibiótico), y el listado de productos
-- del sistema todavía no publica el campo. Se pidió que lo agregue; cuando
-- llegue, `sync-products` lo escribe acá y esta siembra deja de importar.
--
-- NULL significa **no se sabe**, y es distinto de false: con false el portal no
-- pide lote, así que un NULL mal convertido a false es justamente el bug que
-- esta columna viene a cerrar.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS regulado boolean;

COMMENT ON COLUMN public.products.regulado IS
  'Si el producto lleva control de lote en el sistema de origen. NULL = todavía '
  'no se sabe (el portal no pide lote obligatorio, pero avisa). Lo mantiene '
  'sync-products cuando el listado de productos publique el campo; hasta '
  'entonces vale la siembra del 2026-08-12.';

-- ── La siembra, medida y no supuesta (2026-08-12) ──────────────────────────
--
-- El inventario del portal ya guarda el lote de cada existencia, así que
-- clasifica solo a los productos cuyas filas son todas del mismo tipo: con lote
-- real lleva control, todas 'GENERICO' no lo lleva. Se enfrentaron 10 de esos
-- casos contra el sistema de origen: 10 coincidencias.
--
-- Los que mezclan las dos formas NO se infieren: son existencias viejas con lote
-- de una época anterior, y de 6 probados la inferencia falló en 3. Esos van
-- abajo, uno por uno, con el valor que contestó el sistema.
WITH clases AS (
    SELECT erp_product_id AS id,
           bool_or(lote IS NOT NULL AND lote <> 'GENERICO') AS con_lote,
           bool_or(lote IS NULL OR lote = 'GENERICO')       AS con_generico
    FROM public.inventory
    WHERE cantidad > 0
    GROUP BY 1
)
UPDATE public.products p
SET    regulado = c.con_lote
FROM   clases c
WHERE  p.id = c.id
  AND  c.con_lote <> c.con_generico          -- sólo las clases puras
  AND  p.regulado IS DISTINCT FROM c.con_lote;

-- Los 160 mezclados que el sistema de origen sí supo contestar el 2026-08-12
-- (tienen existencia, así que su ficha de descargo publica el control de lote).
-- Los 3 restantes —1996, 2849, 4303— no contestaron y quedan en NULL.
UPDATE public.products SET regulado = true
WHERE  id IN (17,35,187,238,270,293,607,712,862,882,908,939,1137,1151,1271,1272,
              1273,1276,1383,1396,1767,1952,1990,2001,2011,2013,2014,2017,2046,
              2078,2170,2235,2319,2398,2441,2450,2616,2634,2672,2673,2682,2684,
              2685,2705,2711,2751,2755,2804,2885,2907,2908,2991,3022,3023,3164,3168,3192,
              3242,3272,3348,3458,3500,3530,3678,3679,3684,3825,4044,4079,4294,
              4522,4688)
  AND  regulado IS DISTINCT FROM true;

UPDATE public.products SET regulado = false
WHERE  id IN (56,201,209,245,296,443,567,612,631,640,710,729,754,885,915,937,941,
              1055,1060,1099,1112,1123,1133,1140,1327,1389,1460,1468,1470,1736,
              1872,1873,1877,1907,1974,1979,2105,2175,2211,2215,2257,2258,2299,
              2302,2455,2484,2485,2509,2537,2631,2636,2651,2657,2732,2734,2744,
              2746,2768,2792,2994,3026,3033,3056,3058,3062,3099,3105,3123,3126,
              3133,3135,3199,3252,3337,3342,3345,3356,3398,3497,3511,3564,3612,
              3647,3956,4240,4242,4382,4770)
  AND  regulado IS DISTINCT FROM false;
