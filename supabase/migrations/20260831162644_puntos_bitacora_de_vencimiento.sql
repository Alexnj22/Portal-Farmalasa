SET lock_timeout = '5s';

-- ── La bitácora del vencimiento ──────────────────────────────────────────────
-- Quitar puntos es la única cosa que este circuito hace que el cliente puede
-- sentir como un agravio, así que cada corrida deja fila: qué día se miró, con
-- qué corte, cuánto habría vencido y cuánto se quitó de verdad.
--
-- Existe desde ANTES de que se quite el primer punto, y ése es el punto: el
-- primer vencimiento posible es un año después de que arranque el programa, y
-- durante ese año la función corre en modo mirar. Cuando llegue el día, la
-- decisión de encenderla se va a poder tomar contra doce mediciones y no contra
-- una estimación — y si algo estaba mal, se va a ver en la bitácora antes de
-- que le pase a nadie.
--
-- `simulado` distingue las dos cosas. Sin esa columna, doce filas de mirar y
-- una de aplicar se leerían igual.
CREATE TABLE IF NOT EXISTS public.puntos_vencimiento_log (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  simulado       boolean     NOT NULL DEFAULT true,
  -- El día contra el que se evaluó. No es `now()`: una corrida se puede repetir
  -- con otra fecha para medir, y entonces las dos filas dirían lo mismo.
  evaluado_al    date        NOT NULL,
  -- Con la regla de gracia: lo viejo cuenta su año desde que arranca el
  -- programa. Es lo que de verdad vence.
  clientes       integer     NOT NULL DEFAULT 0,
  puntos         bigint      NOT NULL DEFAULT 0,
  -- Sin la gracia: lo que vencería si cada punto contara desde su propia
  -- compra. No se aplica nunca — se mide para saber el tamaño del escalón que
  -- llega el día del primer aniversario.
  clientes_sin_gracia integer NOT NULL DEFAULT 0,
  puntos_sin_gracia   bigint  NOT NULL DEFAULT 0,
  -- Cuentas cuyo historial no suma su propio saldo: no se les toca nada.
  descuadrados   integer     NOT NULL DEFAULT 0,
  detalle        jsonb,
  ms             integer
);

CREATE INDEX IF NOT EXISTS idx_puntos_venc_log_fecha
  ON public.puntos_vencimiento_log(created_at DESC);

ALTER TABLE public.puntos_vencimiento_log ENABLE ROW LEVEL SECURITY;

-- La escribe la función con service_role, que no pasa por RLS. Leerla es ver
-- cuánto dinero en puntos se evaporó: mismo permiso que el resto de puntos.
CREATE POLICY "ver bitacora de vencimiento" ON public.puntos_vencimiento_log
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('ventas', 'can_view')));

COMMENT ON TABLE public.puntos_vencimiento_log IS
  'Una fila por corrida del vencimiento de puntos. `simulado` = miró sin quitar nada.';
