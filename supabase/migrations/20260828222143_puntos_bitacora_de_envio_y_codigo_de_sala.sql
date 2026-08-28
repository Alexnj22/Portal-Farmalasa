SET lock_timeout = '5s';

-- ── El código de la sala en el sistema de puntos ─────────────────────────────
-- No se deriva del `codigo` del portal aunque lo parezca: S1..S5 dan FLS1..FLS5
-- pero La Popular es LP y allá es FLP1. Una regla escrita a mano fallaría en una
-- de seis salas y en silencio, que es la forma en que estas cosas sobreviven.
-- El valor ES la clave del otro sistema, así que vive en la tabla.
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS codigo_puntos text;

COMMENT ON COLUMN public.branches.codigo_puntos IS
  'Código de la sala en la base de puntos (FLP1, FLS1..FLS5). NULL = la sala no acumula puntos.';

UPDATE public.branches SET codigo_puntos = v.cp
FROM (VALUES (2,'FLP1'),(4,'FLS1'),(25,'FLS2'),(27,'FLS3'),(28,'FLS4'),(29,'FLS5')) AS v(id, cp)
WHERE public.branches.id = v.id AND public.branches.codigo_puntos IS DISTINCT FROM v.cp;

-- ── El registro de lo que ya se mandó ────────────────────────────────────────
-- Existe para tres cosas que la hoja de cálculo resolvía con una propiedad del
-- script (`lastSync_<sala>` = el último correlativo) y por eso no resolvía bien:
--   1. no volver a mandar lo mandado — pero por FACTURA, no por «llegué hasta el
--      número N». Una factura que entra tarde al portal (el sync del ERP no
--      garantiza orden) quedaba abajo del número y no se mandaba nunca.
--   2. saber qué se mandó, para poder restarlo si después se anula.
--   3. poder contestar «¿esta venta ganó puntos?» sin preguntarle al otro sistema.
CREATE TABLE IF NOT EXISTS public.puntos_enviados (
  invoice_id      bigint PRIMARY KEY REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  sucursal        text        NOT NULL,
  erp_invoice_id  text        NOT NULL,
  correlativo     text,
  cliente         text,
  cod_vendedor    integer,
  total           numeric(12,2) NOT NULL,
  fecha           date        NOT NULL,
  enviado_at      timestamptz NOT NULL DEFAULT now(),
  -- Cuando el portal detecta que la factura dejó de estar FINALIZADA.
  anulada_at      timestamptz,
  estado_anulada  text,
  -- Cuando se le avisó a la sala para que verifique los puntos.
  avisada_at      timestamptz,
  -- Cuando el otro sistema confirmó que la restó.
  revertida_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puntos_enviados_fecha    ON public.puntos_enviados(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_puntos_enviados_sucursal ON public.puntos_enviados(sucursal, fecha DESC);
-- Parcial: la cola de «hay que avisar», que es lo único que se consulta caliente.
CREATE INDEX IF NOT EXISTS idx_puntos_enviados_por_avisar
  ON public.puntos_enviados(anulada_at) WHERE anulada_at IS NOT NULL AND avisada_at IS NULL;

ALTER TABLE public.puntos_enviados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS puntos_enviados_select ON public.puntos_enviados;
CREATE POLICY puntos_enviados_select ON public.puntos_enviados
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('ventas','can_view')));

-- Sin policy de INSERT/UPDATE/DELETE a propósito: lo escribe el circuito con
-- service_role, que no pasa por RLS. Una policy de escritura acá sería un
-- permiso que nadie necesita.

COMMENT ON TABLE public.puntos_enviados IS
  'Bitácora de las ventas que el portal mandó a la base de puntos. Una fila por factura.';
