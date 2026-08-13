SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- De dónde salió el costo de una línea vendida, y cómo reconstruir los 15 meses
-- que no lo tienen.
--
-- EL PROBLEMA. `costo_unitario` se empezó a capturar el 2026-08-05. Antes de esa
-- fecha hay **585,040 líneas en NULL**, del 2025-05-01 al 2026-08-04 — quince
-- meses. Sin costo de venta no hay Estado de Resultados ni se cumple el
-- «importe de las que salen» que pide el Art. 142-A CT para el registro de
-- control de inventarios.
--
-- LO QUE NO SE HACE, Y POR QUÉ. La migración 20260806004055 decidió que el
-- trigger NO estampe costo sobre ventas de más de 15 días: *«un dato inventado
-- que se lee como medido es peor que un NULL»*. Esa decisión sigue en pie y esta
-- migración NO la toca — porque la fuente de aquélla es `product_precios`, que
-- es la LISTA DE HOY, y aplicarla a quince meses atrás es exactamente el dato
-- inventado que se quiso evitar.
--
-- `product_precios_history` tampoco sirve, aunque su forma engañe: es una tabla
-- temporal con `valid_from`/`valid_until`, pero su columna `costo` está **NULL
-- en las 26,739 filas** y dejó de recibir versiones el 2026-06-03.
--
-- LO QUE SÍ SE HACE. Reconstruir desde las COMPRAS REALES. Medido el 2026-08-13:
-- `purchase_receipt_items` cubre 2025-05-01 → 2026-08-13 —el mismo rango que las
-- ventas sin costo— y **545,865 de las 585,040 líneas (93.3%)** tienen una compra
-- de ese producto anterior a la venta, con **mediana de 9 días**. No es una
-- estimación: es el precio de un documento de compra.
--
-- LA UNIDAD, que es donde esto se rompía en silencio. Medido sobre 3,217
-- productos: `purchase_receipt_items.precio_unitario` está en la UNIDAD BASE
-- (ratio 1.000 contra `product_precios.costo` de factor 1, y 3,213 de 3,217
-- dentro de ±10%). Pero `product_precios.costo` con factor N es **N veces** el de
-- factor 1 —mediana exacta 10.000, 100.000, 50.000— o sea que es el costo del
-- PAQUETE. Las ventas traen `factor_unidades`, y 67,991 líneas tienen factor 10.
-- Sin multiplicar por el factor esas líneas quedarían con **una décima** de su
-- costo real, y se verían perfectamente creíbles.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · LA PROCEDENCIA ──────────────────────────────────────────────────────
-- Sin esta columna, un costo reconstruido y uno capturado en vivo se leen igual.
-- Es el mismo problema que evitó la migración del 06-08, sólo que ahora con
-- 545,865 filas: dentro de seis meses nadie podría distinguirlos, y el Estado de
-- Resultados no podría decir qué parte de su margen es medida y qué parte es
-- reconstruida.
--
-- Nullable y sin DEFAULT a propósito: en PG11+ eso es un cambio de metadatos y
-- no reescribe la tabla, que acá tiene 594,237 filas y la escriben los crons cada
-- minuto.
ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS costo_origen text;

ALTER TABLE public.sales_invoice_items
  DROP CONSTRAINT IF EXISTS sales_invoice_items_costo_origen_chk;
ALTER TABLE public.sales_invoice_items
  ADD CONSTRAINT sales_invoice_items_costo_origen_chk
  CHECK (costo_origen IS NULL OR costo_origen IN ('lista','compras'));

COMMENT ON COLUMN public.sales_invoice_items.costo_origen IS
  'De dónde salió costo_unitario. lista = capturado al vender, de product_precios (trigger, ventana de 15 días). compras = reconstruido del último documento de compra anterior a la venta. NULL = sin costo. Un valor reconstruido NUNCA debe leerse como medido.';

-- Las 9,197 ya costeadas salieron todas del trigger, o sea de la lista.
UPDATE public.sales_invoice_items
   SET costo_origen = 'lista'
 WHERE costo_unitario IS NOT NULL AND costo_origen IS NULL;

-- ── 2 · EL TRIGGER DECLARA SU PROCEDENCIA ───────────────────────────────────
-- Mismo cuerpo que 20260806004055 —la ventana de 15 días NO se toca— más la
-- marca. Si el trigger no la escribiera, toda captura futura quedaría en NULL y
-- la columna mentiría por omisión justo en el camino que más se usa.
CREATE OR REPLACE FUNCTION public.sales_invoice_items_congelar_costo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_fecha date;
BEGIN
    IF NEW.costo_unitario IS NOT NULL
       OR NEW.erp_product_id IS NULL
       OR NEW.factor_unidades IS NULL THEN
        RETURN NEW;
    END IF;

    -- "Al momento de la venta" es literal: si la factura no es de los últimos
    -- 15 días, esto no es una captura sino una reconstrucción, y no se hace acá.
    SELECT si.fecha INTO v_fecha
      FROM public.sales_invoices si
     WHERE si.id = NEW.invoice_id;

    IF v_fecha IS NULL OR v_fecha < current_date - 15 THEN
        RETURN NEW;
    END IF;

    SELECT (array_agg(pp.costo ORDER BY pp.activo DESC, pp.updated_at DESC NULLS LAST, pp.id))[1],
           count(DISTINCT pp.costo) > 1
      INTO NEW.costo_unitario, NEW.costo_ambiguo
      FROM public.product_precios pp
     WHERE pp.product_id = NEW.erp_product_id
       AND pp.factor     = NEW.factor_unidades
       AND pp.costo      > 0;

    IF NEW.costo_unitario IS NOT NULL THEN
        NEW.costo_origen := 'lista';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sales_invoice_items_congelar_costo() IS
    'BEFORE INSERT: congela el costo de lista de la línea vendida, sólo si la factura es de los últimos 15 días, y lo marca costo_origen=lista. Un re-sync forzado de un mes viejo NO estampa el costo de hoy — deja NULL.';

-- ── 3 · LA RECONSTRUCCIÓN, EN TANDAS ────────────────────────────────────────
-- Por tandas y no de un saque: `sales_invoice_items` es de las tablas calientes
-- —los crons de sync escriben cada minuto (CLAUDE.md)— y un UPDATE de 545,865
-- filas mantendría el lock lo suficiente como para encolar todo lo demás. El
-- llamador itera hasta que devuelva 0.
--
-- Sólo `service_role`: es una herramienta de backfill, no una acción de la app.
-- Ninguna pantalla la llama y `authenticated` no puede ejecutarla.
CREATE OR REPLACE FUNCTION public.reconstruir_costo_de_venta(
  p_desde  date,
  p_hasta  date,
  p_limite integer DEFAULT 5000
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH candidatas AS (
    SELECT sii.id, sii.erp_product_id AS pid, sii.factor_unidades AS factor, si.fecha
      FROM public.sales_invoice_items sii
      JOIN public.sales_invoices si ON si.id = sii.invoice_id
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND sii.costo_unitario IS NULL
       AND sii.erp_product_id IS NOT NULL
       AND sii.factor_unidades IS NOT NULL
     LIMIT p_limite
  ), resuelto AS (
    SELECT c.id,
           -- La compra está en unidad base; la línea se vendió en paquetes de
           -- `factor`. Sin esta multiplicación las 67,991 líneas de factor 10
           -- quedarían en la décima parte de su costo.
           round((u.precio * c.factor)::numeric, 6) AS costo,
           u.ambiguo
      FROM candidatas c
      JOIN LATERAL (
        SELECT pri.precio_unitario AS precio,
               -- Ambiguo cuando ese mismo día hay más de un precio distinto para
               -- el producto: el número se elige igual, pero se dice que se eligió.
               (count(*) OVER () > 1) AS ambiguo
          FROM public.purchase_receipt_items pri
          JOIN public.purchase_receipts pr ON pr.id = pri.receipt_id
         WHERE pri.erp_product_id = c.pid
           AND pr.fecha <= c.fecha
           AND pri.precio_unitario > 0
           AND pr.fecha = (
             SELECT max(pr2.fecha)
               FROM public.purchase_receipt_items pri2
               JOIN public.purchase_receipts pr2 ON pr2.id = pri2.receipt_id
              WHERE pri2.erp_product_id = c.pid
                AND pr2.fecha <= c.fecha
                AND pri2.precio_unitario > 0
           )
         ORDER BY pri.id DESC
         LIMIT 1
      ) u ON true
  )
  UPDATE public.sales_invoice_items t
     SET costo_unitario = r.costo,
         costo_origen   = 'compras',
         costo_ambiguo  = r.ambiguo
    FROM resuelto r
   WHERE t.id = r.id
     AND t.costo_unitario IS NULL;   -- carrera con el trigger: no repisar

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reconstruir_costo_de_venta(date, date, integer) IS
  'Backfill por tandas del costo de venta histórico, desde el último documento de COMPRA anterior a la venta (precio_unitario x factor_unidades). Marca costo_origen=compras. Sólo toca filas en NULL. Devuelve cuántas cambió; iterar hasta 0.';

REVOKE EXECUTE ON FUNCTION public.reconstruir_costo_de_venta(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconstruir_costo_de_venta(date, date, integer) TO service_role;
