SET lock_timeout = '5s';

-- La bitácora tiene 5,785 filas —lo que mandó el portal— pero del otro lado hay
-- 358,961, puestas por la hoja de cálculo durante más de un año. Sin una fila
-- por cada una, el filtro nuevo diría «Sin enviar» sobre 353 mil ventas que SÍ
-- están: un filtro que miente es peor que no tenerlo.
--
-- Recibe (sucursal, id, aplicado) y crea la fila que falte, resolviendo el resto
-- desde `sales_invoices` — nunca desde lo que mande el llamador. Es la misma
-- razón que en `puntos_marcar_enviadas`: si los datos vinieran de afuera, la
-- bitácora diría lo que el llamador CREE y no lo que la venta es.
--
-- `enviado_at` queda con la fecha de hoy y es una imprecisión conocida y
-- aceptada: no se sabe cuándo las mandó la hoja. Esa columna ordena trabajo
-- pendiente; la fecha de la venta, que es la que importa, sale de la factura.
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
    SELECT (x->>'sucursal')::text        AS sucursal,
           (x->>'id')::text              AS erp_invoice_id,
           (x->>'aplicado')::smallint    AS aplicado
    FROM json_array_elements(p_filas) x
  ),
  resuelto AS (
    SELECT si.id AS invoice_id, b.codigo_puntos AS sucursal, si.erp_invoice_id,
           si.correlativo, si.cliente,
           CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END AS cod_vendedor,
           si.total, si.fecha, e.aplicado
    FROM entrada e
    JOIN public.branches b ON b.codigo_puntos = e.sucursal
    JOIN public.sales_invoices si
      ON si.branch_id = b.id AND si.erp_invoice_id = e.erp_invoice_id
  ),
  ins AS (
    INSERT INTO public.puntos_enviados
      (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
       total, fecha, aplicado, visto_at)
    SELECT invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
           total, fecha, aplicado, now()
    FROM resuelto
    ON CONFLICT (invoice_id) DO UPDATE
       SET aplicado = EXCLUDED.aplicado, visto_at = now()
       -- Sólo si cambió: reescribir una fila idéntica gasta WAL y ensucia los
       -- índices, y esta función corre sobre cientos de miles de filas.
       WHERE public.puntos_enviados.aplicado IS DISTINCT FROM EXCLUDED.aplicado
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_sembrar_desde_destino(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_sembrar_desde_destino(json) TO service_role;
