SET lock_timeout = '5s';

-- `NO_ACUMULA` se agregó a la columna generada y al barrido, y esta función lo
-- rechazó: tiene su propia lista de valores permitidos. La guarda hizo bien su
-- trabajo —el estado nuevo no entró de contrabando— y lo que faltaba era
-- declararlo también acá.
--
-- Vale como recordatorio: un estado nuevo se declara en TRES sitios —la columna
-- generada, esta lista y el rótulo de `src/data/puntos.js`— y ninguno de los
-- tres se entera de los otros dos.
--
-- Sella `revertida_at` como los demás finales: retirar el ticket de una ficha
-- que no acumula deja el caso cerrado, no hay nadie esperando a resolverlo.
CREATE OR REPLACE FUNCTION public.puntos_marcar_revertidas(p_invoice_ids bigint[], p_reversion text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  n integer;
BEGIN
  IF p_reversion NOT IN ('BORRADA', 'RESTADA', 'PUNTOS_YA_DADOS', 'NO_ESTABA', 'NO_ACUMULA') THEN
    RAISE EXCEPTION 'reversion desconocida: %', p_reversion;
  END IF;

  UPDATE public.puntos_enviados
     SET reversion   = p_reversion,
         -- Se sella cuando NO QUEDA NADA que hacer. `PUNTOS_YA_DADOS` no sella
         -- a propósito: es trabajo pendiente de una persona, y una fecha ahí lo
         -- daría por cerrado.
         revertida_at = CASE WHEN p_reversion IN ('BORRADA','RESTADA','NO_ESTABA','NO_ACUMULA')
                             THEN now() ELSE revertida_at END
   WHERE invoice_id = ANY(p_invoice_ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
