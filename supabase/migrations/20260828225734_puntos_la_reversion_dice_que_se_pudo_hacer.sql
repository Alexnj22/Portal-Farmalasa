SET lock_timeout = '5s';

-- Revertir una venta anulada NO es una sola cosa, y confundirlas sería el
-- defecto. Medido contra la base de puntos el 2026-08-28, sobre las 1,033
-- anuladas que conoce el portal:
--
--   · 795 están con `aplicado = 0` — nadie cobró esos puntos todavía. Se borra
--     la fila y listo: el ticket deja de ser canjeable y NINGÚN saldo cambia.
--     Son $17,501.37 hoy canjeables sobre ventas que no existen.
--
--   · 26 están con `aplicado = 1` — los puntos YA se entregaron ($1,110.14).
--     Deshacerlo exige DOS escrituras coordinadas: borrar la fila de `Ventas` y
--     bajar `Clientes.Puntos`, que NO es un derivado sino una caché mantenida
--     (verificado: coincide exacto con Registrados − Redimidos en 10 de 10).
--     Hacer una sola desincroniza el saldo, y el cliente puede haber gastado
--     esos puntos. Eso no lo decide un cron.
--
-- Por eso la columna guarda QUÉ se pudo hacer y no un booleano.
ALTER TABLE public.puntos_enviados
  ADD COLUMN IF NOT EXISTS reversion text;

COMMENT ON COLUMN public.puntos_enviados.reversion IS
  'BORRADA = la fila se quitó y nadie había cobrado los puntos. PUNTOS_YA_DADOS = los puntos ya se entregaron y hay que resolverlo a mano. NULL = todavía no se intentó.';

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
  IF p_reversion NOT IN ('BORRADA', 'PUNTOS_YA_DADOS') THEN
    RAISE EXCEPTION 'reversion desconocida: %', p_reversion;
  END IF;

  UPDATE public.puntos_enviados
     SET reversion   = p_reversion,
         -- `revertida_at` sólo se sella cuando la reversión SE HIZO. El caso de
         -- los puntos ya entregados queda sin sello a propósito: es trabajo
         -- pendiente, y una fecha ahí lo daría por cerrado.
         revertida_at = CASE WHEN p_reversion = 'BORRADA' THEN now() ELSE revertida_at END
   WHERE invoice_id = ANY(p_invoice_ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_revertidas(bigint[], text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_revertidas(bigint[], text) TO service_role;
