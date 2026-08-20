SET lock_timeout = '5s';

-- La guarda «sólo escribe si cambió» comparaba con más decimales de los que la
-- columna puede guardar, así que NUNCA podía decir «son iguales».
--
-- ── El caso, medido ──────────────────────────────────────────────────────────
-- El portal calcula el precio unitario dividiendo: 17.94 ÷ 240 = 0,07475. La
-- columna es `numeric(12,4)`, así que guarda 0,0748. A los 10 minutos el sync
-- vuelve a mandar 0,07475, esta comparación ve que difiere de 0,0748, reescribe
-- la fila… y al escribirla la redondea otra vez a 0,0748. Para siempre.
--
-- **38,5% de las filas (15.778 de 40.929)** tienen una división con más de 4
-- decimales, o sea que son las que se reescribían solas. Medido en una corrida
-- controlada: de 135 renglones enviados, **101 se reescribieron** sin que
-- cambiara un dato, y con **0% HOT** — cada uno rehacía también los índices.
-- Son ~24 MB de WAL por día para no cambiar nada.
--
-- ── Por qué el arreglo no puede alterar un solo dato ──────────────────────────
-- La columna YA redondea al escribir. Redondear en la comparación produce
-- exactamente el valor que se guardaría, así que lo único que cambia es que
-- ahora la comparación puede dar «iguales». Las tres escalas salen de la
-- definición de la tabla y no de un número elegido a mano:
--   cantidad numeric(10,3) · precio_unitario numeric(12,4) · total_linea numeric(12,2)
--
-- La lección general, que vale para toda guarda de este tipo: **comparar en la
-- misma escala en que se guarda**. Una guarda que compara contra un valor que la
-- base nunca va a tener escrito no es una guarda, es un reescritor.
CREATE OR REPLACE FUNCTION public.sync_purchase_receipt_items_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.receipt_id, r.linea_num)
         r.receipt_id, r.linea_num, r.erp_product_id, r.descripcion,
         -- A la escala de la columna ANTES de comparar (ver el encabezado).
         r.cantidad::numeric(10,3)        AS cantidad,
         r.precio_unitario::numeric(12,4) AS precio_unitario,
         r.total_linea::numeric(12,2)     AS total_linea,
         r.lote, r.fecha_vencimiento
  FROM json_to_recordset(p_rows) AS r(
    receipt_id        integer,
    linea_num         integer,
    erp_product_id    integer,
    descripcion       text,
    cantidad          numeric,
    precio_unitario   numeric,
    total_linea       numeric,
    lote              text,
    fecha_vencimiento date
  )
  WHERE r.receipt_id IS NOT NULL AND r.linea_num IS NOT NULL
  ORDER BY r.receipt_id, r.linea_num
),
written AS (
  INSERT INTO public.purchase_receipt_items AS pri
    (receipt_id, linea_num, erp_product_id, descripcion, cantidad,
     precio_unitario, total_linea, lote, fecha_vencimiento)
  SELECT i.receipt_id, i.linea_num, i.erp_product_id, i.descripcion, i.cantidad,
         i.precio_unitario, i.total_linea, i.lote, i.fecha_vencimiento
  FROM incoming i
  ON CONFLICT (receipt_id, linea_num) DO UPDATE
    SET erp_product_id    = EXCLUDED.erp_product_id,
        descripcion       = EXCLUDED.descripcion,
        cantidad          = EXCLUDED.cantidad,
        precio_unitario   = EXCLUDED.precio_unitario,
        total_linea       = EXCLUDED.total_linea,
        lote              = EXCLUDED.lote,
        fecha_vencimiento = EXCLUDED.fecha_vencimiento
    WHERE (pri.erp_product_id, pri.descripcion, pri.cantidad, pri.precio_unitario,
           pri.total_linea, pri.lote, pri.fecha_vencimiento)
          IS DISTINCT FROM
          (EXCLUDED.erp_product_id, EXCLUDED.descripcion, EXCLUDED.cantidad,
           EXCLUDED.precio_unitario, EXCLUDED.total_linea, EXCLUDED.lote,
           EXCLUDED.fecha_vencimiento)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$;

-- ⚠️ NOTA del mismo día, después de medir el resultado: este arreglo era
-- NECESARIO pero no suficiente. Con él desplegado seguían reescribiéndose 68 de
-- 160 renglones por corrida. La causa de fondo estaba afuera: el sistema
-- devuelve los renglones de una compra **en distinto orden en cada lectura**
-- —medido leyendo el mismo rango dos veces seguidas: 13 de 15 compras
-- cambiaron— y `linea_num` era la posición en esa lista. Se cerró ordenando los
-- renglones canónicamente en `sync-erp-purchases` antes de numerarlos.
