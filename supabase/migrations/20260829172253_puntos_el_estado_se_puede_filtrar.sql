SET lock_timeout = '5s';

-- ── Por qué ahora SÍ se espeja, después de decidir que no ────────────────────
-- El 2026-08-28 se resolvió preguntarle el estado a la base de puntos en vez de
-- copiarlo, y el motivo sigue siendo bueno: ese estado cambia en el MOSTRADOR
-- —un ticket pasa a «acumulado» cuando alguien lo presenta, hoy o en seis
-- meses— y una copia vieja miente sin avisar.
--
-- Lo que cambió es el requerimiento: el usuario pidió FILTRAR la lista de ventas
-- por ese estado. Y la lista se pagina en el servidor, así que un filtro que
-- vive en otra base no se puede aplicar — habría que traer las 358,961 claves
-- para saber qué página mostrar. O el estado está en Postgres, o no hay filtro.
--
-- La copia se mantiene fresca en la misma corrida del cron que ya se conecta
-- cada minuto, y `visto_at` dice CUÁNDO se miró: una copia sin esa fecha es la
-- que miente, porque no se puede distinguir «pendiente» de «no lo he mirado».
ALTER TABLE public.puntos_enviados
  ADD COLUMN IF NOT EXISTS aplicado  smallint,
  ADD COLUMN IF NOT EXISTS visto_at  timestamptz;

COMMENT ON COLUMN public.puntos_enviados.aplicado IS
  'Copia de admin_factura.aplicado: 0 = el ticket todavía se puede canjear, 1 = sus puntos ya se entregaron, NULL = no está allá.';
COMMENT ON COLUMN public.puntos_enviados.visto_at IS
  'Cuándo se leyó `aplicado` por última vez. Sin esta fecha, «pendiente» y «todavía no lo miré» se leen igual.';

-- ── El estado, calculado UNA vez y en un solo lugar ──────────────────────────
-- Columna generada y no una vista ni un `CASE` repetido: la misma regla la
-- necesitan el filtro, la columna de la lista y la ficha del cliente, y tres
-- copias de una regla de cinco ramas divergen. Al ser GENERATED, no puede
-- quedar desincronizada de `aplicado` ni de `reversion` — la base la recalcula.
--
-- El orden de las ramas importa: `reversion` gana sobre `aplicado` porque si el
-- portal ya devolvió los puntos, la fila no está del otro lado y `aplicado`
-- sería NULL, que se lee igual que «nunca se mandó». Son cosas distintas.
ALTER TABLE public.puntos_enviados
  ADD COLUMN IF NOT EXISTS estado_puntos text
  GENERATED ALWAYS AS (
    CASE
      WHEN reversion IN ('RESTADA', 'BORRADA') THEN 'devuelto'
      WHEN reversion = 'PUNTOS_YA_DADOS'       THEN 'por_revisar'
      WHEN aplicado = 1                        THEN 'acumulado'
      WHEN aplicado = 0                        THEN 'pendiente'
      ELSE 'sin_enviar'
    END
  ) STORED;

-- El índice que hace posible el filtro: por estado y fecha, que es exactamente
-- como se consulta (un estado dentro de un período).
CREATE INDEX IF NOT EXISTS idx_puntos_enviados_estado
  ON public.puntos_enviados(estado_puntos, fecha DESC);


-- ── Anotar lo que se leyó del otro lado ──────────────────────────────────────
-- Recibe pares (sucursal, id, aplicado) y los aplica sobre la bitácora. Se
-- pasan como un solo json y no fila por fila: son hasta 23,000 en una corrida.
CREATE OR REPLACE FUNCTION public.puntos_anotar_aplicado(p_filas json)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  WITH entrada AS (
    SELECT (x->>'sucursal')::text  AS sucursal,
           (x->>'id')::text        AS erp_invoice_id,
           (x->>'aplicado')::smallint AS aplicado
    FROM json_array_elements(p_filas) x
  )
  UPDATE public.puntos_enviados pe
     SET aplicado = e.aplicado,
         visto_at = now()
    FROM entrada e
   WHERE pe.sucursal = e.sucursal
     AND pe.erp_invoice_id = e.erp_invoice_id
     -- No se reescribe una fila que ya dice lo mismo: un UPDATE que no cambia
     -- nada igual gasta WAL y ensucia los índices, y esto corre cada minuto.
     -- Es la regla de los syncs recurrentes de CLAUDE.md.
     AND pe.aplicado IS DISTINCT FROM e.aplicado;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_anotar_aplicado(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_anotar_aplicado(json) TO service_role;
