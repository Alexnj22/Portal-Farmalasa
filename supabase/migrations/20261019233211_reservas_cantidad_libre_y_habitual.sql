SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Cuántas unidades de un producto lleva normalmente quien lo compra
-- (2026-10-19).
--
-- La reserva de la app tenía un tope fijo de 5 unidades por producto, puesto el
-- 6-oct sin que nadie lo decidiera. Decisión del usuario: la cantidad es LIBRE,
-- pero si es «no habitual» la app le PREGUNTA al cliente si es correcta antes
-- de reservar. «No habitual» = más de lo que se lleva en el 95 % de las
-- facturas de ese producto en los últimos 90 días, nunca menos de 5.
--
-- Se calcula de noche y se guarda: en el momento costaba 5 s para el producto
-- más vendido (11,351 renglones); el cálculo de los 3,195 productos con venta
-- cuesta 0.6 s. Mismo patrón que `app-catalogo-destacados`.
--
-- En UNIDADES (`cantidad × factor_unidades`), porque una reserva puede ser de
-- otra presentación que la de la venta.
-- ═══════════════════════════════════════════════════════════════════════════

-- El tope de 5 unidades también vivía en la BASE, como regla de la tabla: con
-- sólo quitarlo del servidor la reserva fallaba sin decir por qué. La red
-- queda en 999, igual que en el servidor.
ALTER TABLE public.app_reservas DROP CONSTRAINT IF EXISTS app_reservas_cantidad_check;
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_cantidad_check
  CHECK (cantidad >= 1 AND cantidad <= 999);

CREATE TABLE IF NOT EXISTS public.producto_cantidad_habitual (
  product_id   bigint PRIMARY KEY,
  unidades     integer NOT NULL CHECK (unidades >= 5),
  lineas       integer NOT NULL,
  calculado_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.producto_cantidad_habitual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS producto_cantidad_habitual_select ON public.producto_cantidad_habitual;
CREATE POLICY producto_cantidad_habitual_select ON public.producto_cantidad_habitual
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.refresh_producto_cantidad_habitual()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH calc AS (
    SELECT i.erp_product_id::bigint AS product_id,
           greatest(5, ceil(percentile_cont(0.95) WITHIN GROUP
             (ORDER BY i.cantidad * greatest(i.factor_unidades, 1))))::integer AS unidades,
           count(*)::integer AS lineas
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items i ON i.invoice_id = si.id
     WHERE si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
       AND public.venta_valida(si.estado)
       AND i.erp_product_id > 0
     GROUP BY 1
  ), up AS (
    INSERT INTO public.producto_cantidad_habitual AS t (product_id, unidades, lineas, calculado_at)
    SELECT product_id, unidades, lineas, now() FROM calc
    ON CONFLICT (product_id) DO UPDATE
       SET unidades = EXCLUDED.unidades, lineas = EXCLUDED.lineas, calculado_at = EXCLUDED.calculado_at
     WHERE (t.unidades, t.lineas) IS DISTINCT FROM (EXCLUDED.unidades, EXCLUDED.lineas)
    RETURNING 1
  ), fuera AS (
    -- Lo que dejó de venderse en 90 días ya no tiene «cantidad habitual»: sin
    -- fila, la app usa el piso de 5.
    DELETE FROM public.producto_cantidad_habitual t
     WHERE NOT EXISTS (SELECT 1 FROM calc c WHERE c.product_id = t.product_id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up) + (SELECT count(*) FROM fuera) INTO v_n;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.refresh_producto_cantidad_habitual() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_producto_cantidad_habitual() TO service_role;

SELECT public.refresh_producto_cantidad_habitual();

-- 02:50 SV, después del catálogo de destacados (02:40). Sólo la base propia.
SELECT cron.schedule('app-cantidad-habitual', '50 8 * * *',
                     $$SELECT public.refresh_producto_cantidad_habitual();$$);
