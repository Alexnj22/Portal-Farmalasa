SET lock_timeout = '5s';

-- ── La siembra reventaba: «ON CONFLICT cannot affect row a second time» ──────
-- Al aceptar los dos códigos de La Popular apareció el caso que no se había
-- previsto: **2,142 facturas existen bajo AMBOS** (`FLP` y `FLP1`), con montos
-- idénticos — filas que dejó duplicadas el cambio de código. Las dos resuelven
-- a la misma venta del portal, así que el INSERT traía el mismo `invoice_id`
-- dos veces y Postgres lo rechaza. Bien rechazado: sin eso, cuál de las dos
-- ganaba habría dependido del orden en que llegaran.
--
-- ⚠️ Y de esas 2,142, **27 tienen sus puntos cobrados bajo LOS DOS códigos**:
-- el mismo ticket acreditó puntos dos veces. Eso NO lo arregla esta migración
-- —es un dato del otro sistema y hay que decidir qué hacer con él— pero queda
-- escrito acá porque se descubrió por este camino y nadie más lo estaba
-- mirando.
--
-- La regla de desempate: gana la que tiene los puntos COBRADOS, porque es el
-- hecho más fuerte —alguien recibió esos puntos— y porque marcar «pendiente»
-- una venta ya cobrada la dejaría canjeable de nuevo. Si empatan, gana el
-- código vigente.
CREATE OR REPLACE FUNCTION public.puntos_sembrar_desde_destino(p_filas json)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  WITH entrada AS (
    SELECT (x->>'sucursal')::text     AS sucursal,
           (x->>'id')::text           AS erp_invoice_id,
           (x->>'aplicado')::smallint AS aplicado
    FROM json_array_elements(p_filas) x
  ),
  resuelto AS (
    SELECT DISTINCT ON (si.id)
           si.id AS invoice_id, e.sucursal, si.erp_invoice_id,
           si.correlativo, si.cliente,
           CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END AS cod_vendedor,
           si.total, si.fecha, e.aplicado
    FROM entrada e
    JOIN public.branches b
      ON e.sucursal IN (b.codigo_puntos, b.codigo_puntos_previo)
    JOIN public.sales_invoices si
      ON si.branch_id = b.id AND si.erp_invoice_id = e.erp_invoice_id
    ORDER BY si.id,
             e.aplicado DESC NULLS LAST,                    -- cobrada primero
             (e.sucursal = b.codigo_puntos) DESC            -- y si empatan, el código vigente
  ),
  ins AS (
    INSERT INTO public.puntos_enviados
      (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
       total, fecha, aplicado, visto_at)
    SELECT invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
           total, fecha, aplicado, now()
    FROM resuelto
    ON CONFLICT (invoice_id) DO UPDATE
       SET aplicado = EXCLUDED.aplicado,
           sucursal = EXCLUDED.sucursal,
           visto_at = now()
       WHERE public.puntos_enviados.aplicado IS DISTINCT FROM EXCLUDED.aplicado
          OR public.puntos_enviados.sucursal IS DISTINCT FROM EXCLUDED.sucursal
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_sembrar_desde_destino(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_sembrar_desde_destino(json) TO service_role;
