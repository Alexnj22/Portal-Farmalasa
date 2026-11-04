-- sync_inventory_batch: descartar las filas iguales con UNA lectura de la sala
-- (2026-11-04).
--
-- Corre 7 salas × 2 áreas cada minuto. En una corrida sin cambios —la típica—
-- el ON CONFLICT buscaba cada fila entrante por el índice de `sync_key` y el
-- DELETE hacía un NOT EXISTS por fila de la tabla: 20,797 bloques para 3,286
-- filas de Salud 1, cuando `inventory` entera ocupa 2,234. Ahora se lee la
-- sala una vez (`actual`), un hash join aparta lo nuevo o cambiado y sólo eso
-- llega al INSERT; el borrado es un hash anti join contra la misma lectura.
--
-- Medido en transacción revertida contra Salud 1 (payload real con 299
-- cambios, 259 bajas y un alta; y sin cambios): mismo `written`/`deleted` y
-- mismo md5 de la tabla resultante en los tres casos. Sin cambios:
-- 20,797 → 868 bloques, 38 → 19 ms. Con cambios: 43 → 34 ms.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sync_inventory_batch(p_erp_sucursal_id integer, p_is_vencidos boolean, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT * FROM jsonb_to_recordset(p_rows) AS r(
    erp_product_id    integer,
    descripcion       text,
    presentacion      text,
    detalle           text,
    lote              text,
    fecha_vencimiento date,
    cantidad          integer,
    sync_key          text
  )
),
-- Lo que la sala tiene HOY, leído una sola vez (2026-11-04). Antes cada fila
-- entrante buscaba la suya por el índice de `sync_key` desde el ON CONFLICT
-- —~7 bloques por fila, 23,500 por corrida de 3,286 filas— aunque casi
-- ninguna cambie. Con un hash join contra esta lectura se descartan las
-- iguales antes, y al INSERT sólo llegan las nuevas o las que cambiaron.
actual AS MATERIALIZED (
  SELECT inv.sync_key, inv.cantidad, inv.descripcion, inv.presentacion
    FROM public.inventory inv
   WHERE inv.erp_sucursal_id = p_erp_sucursal_id
     AND inv.is_vencidos = p_is_vencidos
),
cambian AS (
  SELECT i.*
    FROM incoming i
    LEFT JOIN actual a ON a.sync_key = i.sync_key
   WHERE a.sync_key IS NULL
      OR (a.cantidad, a.descripcion, a.presentacion)
         IS DISTINCT FROM (i.cantidad, i.descripcion, i.presentacion)
),
upserted AS (
  INSERT INTO public.inventory AS inv
    (erp_sucursal_id, is_vencidos, erp_product_id, descripcion, presentacion,
     detalle, lote, fecha_vencimiento, cantidad, synced_at, sync_key)
  SELECT p_erp_sucursal_id, p_is_vencidos, i.erp_product_id, i.descripcion,
         i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.cantidad,
         now(), i.sync_key
  FROM cambian i
  ON CONFLICT (sync_key) DO UPDATE
    SET cantidad     = EXCLUDED.cantidad,
        descripcion  = EXCLUDED.descripcion,
        presentacion = EXCLUDED.presentacion,
        synced_at    = EXCLUDED.synced_at
    -- Solo escribir si el dato real cambió (lote/detalle/fecha_venc/producto
    -- forman parte del sync_key, no pueden divergir en un conflicto). Se
    -- queda aunque `cambian` ya filtre: un sync_key de OTRA sala/área no está
    -- en `actual` y llega acá igual que antes.
    WHERE (inv.cantidad, inv.descripcion, inv.presentacion)
          IS DISTINCT FROM
          (EXCLUDED.cantidad, EXCLUDED.descripcion, EXCLUDED.presentacion)
  RETURNING 1
),
removed AS (
  -- Filas de esta sucursal/área que ya no existen en el ERP: diferencia de
  -- sync_keys, ahora contra `actual` (hash anti join) en vez de un NOT EXISTS
  -- por fila de la tabla.
  DELETE FROM public.inventory inv
   USING (SELECT a.sync_key FROM actual a
           WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.sync_key = a.sync_key)) g
   WHERE inv.sync_key = g.sync_key
     AND inv.erp_sucursal_id = p_erp_sucursal_id
     AND inv.is_vencidos = p_is_vencidos
  RETURNING 1
)
SELECT jsonb_build_object(
  'written', (SELECT count(*) FROM upserted),
  'deleted', (SELECT count(*) FROM removed)
);
$function$
;
