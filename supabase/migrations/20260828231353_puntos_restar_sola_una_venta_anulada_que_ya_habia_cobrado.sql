SET lock_timeout = '5s';

-- El cuarto valor: la reversión que el portal hizo SOLO. Son tres escrituras
-- que van juntas o no van —quitar la fila de `Ventas`, bajar `Clientes.Puntos`
-- (una caché mantenida, no un derivado) y borrar la de `admin_factura` para que
-- el ticket no vuelva a ser canjeable—, y por eso van en transacción.
--
-- Sólo se resta cuando el vínculo se puede PROBAR. `TicketFactura` no es una
-- clave: se escribe en el mostrador. Medido sobre los 26 casos históricos del
-- 2026-08-28, DOS no cierran — una factura de FLS4 tiene dos cobros a nombre de
-- dos personas distintas con un año de diferencia (8 puntos sobre $8.60 y 82
-- sobre el mismo documento), y otra figura cobrada sin ninguna venta detrás.
-- Restarle a la persona equivocada es peor que no restar: esos casos se avisan.
--
-- Los 26 históricos quedaron en PUNTOS_YA_DADOS por decisión del usuario
-- («restemos de ahora en adelante»), y el corte no es una fecha sino la
-- bitácora: la corrida que los marcó los sacó de la cola, así que la resta
-- automática nace sin arrastre.
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
  IF p_reversion NOT IN ('BORRADA', 'RESTADA', 'PUNTOS_YA_DADOS', 'NO_ESTABA') THEN
    RAISE EXCEPTION 'reversion desconocida: %', p_reversion;
  END IF;

  UPDATE public.puntos_enviados
     SET reversion   = p_reversion,
         -- Se sella cuando NO QUEDA NADA que hacer. `PUNTOS_YA_DADOS` no sella
         -- a propósito: es trabajo pendiente de una persona, y una fecha ahí lo
         -- daría por cerrado.
         revertida_at = CASE WHEN p_reversion IN ('BORRADA','RESTADA','NO_ESTABA')
                             THEN now() ELSE revertida_at END
   WHERE invoice_id = ANY(p_invoice_ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_revertidas(bigint[], text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_revertidas(bigint[], text) TO service_role;

COMMENT ON COLUMN public.puntos_enviados.reversion IS
  'BORRADA = se quitó la fila y nadie había cobrado los puntos. RESTADA = los puntos se devolvieron solos (venta, saldo y registro). PUNTOS_YA_DADOS = ya se cobraron y el vínculo no es inequívoco: lo tiene que ver una persona. NO_ESTABA = nunca llegó a la base de puntos. NULL = todavía no se intentó.';
