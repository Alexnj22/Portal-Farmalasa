SET lock_timeout = '5s';

-- ── Un rótulo que junta dos cosas que no son la misma ────────────────────────
-- `estado_puntos` devolvía 'devuelto' tanto para BORRADA como para RESTADA, y
-- son hechos MUY distintos:
--
--   · BORRADA  → la venta se anuló y sus puntos NUNCA se habían canjeado. Se
--     quitó el ticket del registro para que no se pudiera canjear una venta que
--     ya no existe. **NINGÚN cliente perdió un punto.**
--   · RESTADA  → los puntos ya se le habían entregado a alguien y se le
--     restaron del saldo.
--
-- Lo levantó el usuario mirando la lista: vio «DEVUELTOS» en ventas anuladas y
-- preguntó si se le habían quitado puntos a un cliente que nunca los canjeó.
-- La respuesta era que no —las 796 son BORRADA y cero son RESTADA— pero la
-- pantalla decía lo contrario. Un rótulo que hace preguntar «¿le quitamos algo
-- a alguien?» ya falló, aunque la respuesta sea que no.
ALTER TABLE public.puntos_enviados DROP COLUMN IF EXISTS estado_puntos;

ALTER TABLE public.puntos_enviados
  ADD COLUMN estado_puntos text
  GENERATED ALWAYS AS (
    CASE
      WHEN reversion = 'BORRADA'         THEN 'retirado'
      WHEN reversion = 'RESTADA'         THEN 'devuelto'
      WHEN reversion = 'PUNTOS_YA_DADOS' THEN 'por_revisar'
      WHEN aplicado = 1                  THEN 'acumulado'
      WHEN aplicado = 0                  THEN 'pendiente'
      ELSE 'sin_enviar'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_puntos_enviados_estado
  ON public.puntos_enviados(estado_puntos, fecha DESC);
