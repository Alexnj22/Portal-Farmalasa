SET lock_timeout = '5s';

-- Hay un TERCER caso y no tenía nombre: la factura anulada que nunca llegó a la
-- base de puntos. De las 1,033 que el portal sabe anuladas, 795 están ahí con
-- los puntos sin cobrar, 26 con los puntos ya entregados, y 212 no están. Sin
-- un valor para ésas, quedarían con `reversion` en NULL — indistinguibles de
-- «todavía no se intentó», que es justo la confusión que esta columna existe
-- para evitar.
CREATE OR REPLACE FUNCTION public.puntos_marcar_revertidas(
  p_invoice_ids bigint[],
  p_reversion   text
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  IF p_reversion NOT IN ('BORRADA', 'PUNTOS_YA_DADOS', 'NO_ESTABA') THEN
    RAISE EXCEPTION 'reversion desconocida: %', p_reversion;
  END IF;

  UPDATE public.puntos_enviados
     SET reversion   = p_reversion,
         -- `revertida_at` sólo se sella cuando NO QUEDA NADA que hacer: la fila
         -- se borró, o nunca estuvo. El caso de los puntos ya entregados queda
         -- sin sello a propósito — es trabajo pendiente, y una fecha ahí lo
         -- daría por cerrado.
         revertida_at = CASE WHEN p_reversion IN ('BORRADA','NO_ESTABA')
                             THEN now() ELSE revertida_at END
   WHERE invoice_id = ANY(p_invoice_ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_revertidas(bigint[], text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_revertidas(bigint[], text) TO service_role;

COMMENT ON COLUMN public.puntos_enviados.reversion IS
  'BORRADA = se quitó la fila y nadie había cobrado los puntos. PUNTOS_YA_DADOS = los puntos ya se entregaron y hay que resolverlo a mano. NO_ESTABA = la factura nunca llegó a la base de puntos. NULL = todavía no se intentó.';


-- ── La bitácora arranca con lo que ya había mandado la hoja de cálculo ──────
-- El circuito viejo lleva más de un año escribiendo, y el portal no tiene
-- registro de nada de eso. Sin esta siembra, las anuladas de ese período son
-- INVISIBLES para el camino de reversión: no están en `puntos_enviados`, así
-- que `puntos_ventas_anuladas()` no las devuelve y nadie las mira nunca.
--
-- Se siembran SÓLO las anuladas, no las 359,271 filas. El resto no hace falta:
-- el INSERT a la base de puntos es idempotente por su clave (sucursal, id) y no
-- pisa `aplicado`, así que reenviar una venta viva no hace daño. Lo que no se
-- puede perder es la lista de las que hay que deshacer.
--
-- `enviado_at` queda con la fecha de HOY y eso es una imprecisión conocida: no
-- sabemos cuándo las mandó la hoja. Vale porque esa columna sirve para ordenar
-- trabajo pendiente, no para auditar cuándo se acreditó un punto — eso vive del
-- otro lado, en `Ventas.Fecha_ingreso`.
INSERT INTO public.puntos_enviados
  (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor, total, fecha)
SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
       CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
       si.total, si.fecha
FROM public.sales_invoices si
JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
WHERE si.estado <> 'FINALIZADA'
  AND si.erp_invoice_id ~ '^[0-9]+$'
ON CONFLICT (invoice_id) DO NOTHING;
