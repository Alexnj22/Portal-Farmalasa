SET lock_timeout = '5s';

-- ── Por qué TODA venta lleva fila, incluso la que no gana puntos ─────────────
-- El filtro nuevo tiene cinco valores y cuatro salen de una fila de esta tabla.
-- El quinto —«Sin enviar»— sería la AUSENCIA de fila, y una ausencia no se puede
-- filtrar con un join: PostgREST no expresa un anti-join, así que ese valor
-- quedaría fuera del filtro o habría que escribir una consulta aparte para él.
--
-- Sale más barato invertir el modelo: la tabla pasa a significar «lo que el
-- portal sabe de los puntos de esta venta», y eso incluye saber que NO gana.
-- Así los cinco estados se filtran igual y nadie tiene que acordarse de que uno
-- es distinto — que es exactamente el tipo de excepción que después se olvida.
--
-- `aplicado` queda en NULL: no está del otro lado, y la columna generada lo
-- traduce a 'sin_enviar'. NULL y 0 no son lo mismo y por eso son dos valores.
INSERT INTO public.puntos_enviados
  (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
   total, fecha, enviado_at)
SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
       CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
       si.total, si.fecha, now()
FROM public.sales_invoices si
JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
LEFT JOIN public.puntos_enviados pe ON pe.invoice_id = si.id
WHERE pe.invoice_id IS NULL
ON CONFLICT (invoice_id) DO NOTHING;


-- ── Y las que nazcan de acá en adelante ──────────────────────────────────────
-- Sin esto la invariante se rompe sola: cada día hay ~100 ventas que el portal
-- decide NO mandar (de $1 o menos, o con un renglón bajo el precio 3), y sin
-- fila volverían a ser un hueco invisible para el filtro. La llama el cron en
-- cada corrida y cuesta unas pocas filas.
CREATE OR REPLACE FUNCTION public.puntos_marcar_sin_enviar(p_desde date, p_hasta date)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
     total, fecha, enviado_at)
  SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
         CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
         si.total, si.fecha, now()
  FROM public.sales_invoices si
  JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
  LEFT JOIN public.puntos_enviados pe ON pe.invoice_id = si.id
  WHERE pe.invoice_id IS NULL
    AND si.fecha BETWEEN p_desde AND p_hasta
  ON CONFLICT (invoice_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_sin_enviar(date, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_sin_enviar(date, date) TO service_role;
