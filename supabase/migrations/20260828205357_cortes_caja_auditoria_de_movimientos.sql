-- Auditoría de los movimientos de caja — F1 de docs/PLAN-CAJA-EN-EL-PORTAL-2026-08-28.md
--
-- Los movimientos de caja se pueden EDITAR y BORRAR en el sistema de origen sin
-- dejar rastro, y hasta hoy el portal no se enteraba de ninguna de las dos
-- cosas: `sync-cortes-caja` hace `upsert` de lo que ve, así que un movimiento
-- borrado allá seguía apareciendo acá para siempre, y uno editado se pisaba sin
-- guardar el valor viejo.
--
-- No es teórico. El 22-ago-2026 en Salud 1 apareció un ingreso de $454.00 —el
-- monto exacto del sobrante del corte anterior— que dejó la diferencia en cero.
-- Con la tabla como estaba, eso no dispara nada y no queda historia de nada.
--
-- Lo comprobé escribiendo: el 28-ago creé el movimiento 43260 en la apertura
-- viva de Salud 1 y lo borré; del lado del origen no queda ni el número.
--
-- Tres piezas:
--
--   visto_at         la última vez que la captura lo encontró en el origen.
--   desaparecido_at  cuándo dejó de estar. NULL = sigue vivo.
--   origen           CAJA (lo tecleó una persona allá) · PORTAL (lo escribió el
--                    portal). Hoy todo es CAJA; el PORTAL llega en la F2.
--
-- Y el historial, que es lo que el origen no tiene: una fila por cada cambio
-- OBSERVADO, con el antes y el después. Append-only, sin policy de DELETE.
--
-- Por qué `corte_id` en el historial: lo que interesa no es que un movimiento
-- cambie, es que cambie DESPUÉS de un corte. Reconstruir a posteriori cuál era
-- el corte vigente en ese instante es adivinar; guardarlo al observarlo, no.

SET lock_timeout = '5s';

-- ── Las tres columnas nuevas ────────────────────────────────────────────────
--
-- Se agregan NULL y se rellenan a mano antes de exigirlas: con `DEFAULT now()`
-- en el ADD COLUMN, las 1,802 filas que ya existen dirían que se las vio ahora
-- mismo, que es falso. `updated_at` es la última vez que la captura las
-- escribió, o sea lo más cerca de "cuándo se la vio" que existe.
ALTER TABLE public.cortes_caja_movimientos
  ADD COLUMN IF NOT EXISTS visto_at        timestamptz,
  ADD COLUMN IF NOT EXISTS desaparecido_at timestamptz,
  ADD COLUMN IF NOT EXISTS origen          text;

UPDATE public.cortes_caja_movimientos
   SET visto_at = coalesce(visto_at, updated_at, capturado_at),
       origen   = coalesce(origen, 'CAJA')
 WHERE visto_at IS NULL OR origen IS NULL;

ALTER TABLE public.cortes_caja_movimientos
  ALTER COLUMN visto_at SET DEFAULT now(),
  ALTER COLUMN visto_at SET NOT NULL,
  ALTER COLUMN origen   SET DEFAULT 'CAJA',
  ALTER COLUMN origen   SET NOT NULL;

ALTER TABLE public.cortes_caja_movimientos
  DROP CONSTRAINT IF EXISTS cortes_caja_mov_origen_chk;
ALTER TABLE public.cortes_caja_movimientos
  ADD CONSTRAINT cortes_caja_mov_origen_chk CHECK (origen IN ('CAJA','PORTAL'));

COMMENT ON COLUMN public.cortes_caja_movimientos.visto_at IS
  'Última vez que la captura lo encontró en el sistema de origen.';
COMMENT ON COLUMN public.cortes_caja_movimientos.desaparecido_at IS
  'Cuándo dejó de estar en el origen. NULL = vigente. Sólo se marca dentro del rango de fechas que esa corrida realmente pidió.';
COMMENT ON COLUMN public.cortes_caja_movimientos.origen IS
  'CAJA = lo tecleó una persona en el sistema de la caja · PORTAL = lo escribió el portal.';

-- ── El historial ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cortes_caja_movimientos_historial (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id         integer NOT NULL REFERENCES public.branches(id),
  erp_movimiento_id integer NOT NULL,
  fecha             date,
  cambio            text NOT NULL
                    CHECK (cambio IN ('APARECIO','EDITADO','DESAPARECIO','REAPARECIO')),
  concepto_antes    text,
  concepto_despues  text,
  monto_antes       numeric(12,2),
  monto_despues     numeric(12,2),
  tipo_antes        text,
  tipo_despues      text,
  -- El corte vigente de esa sala al momento de observar el cambio.
  corte_id          bigint REFERENCES public.cortes_caja(id),
  observado_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cortes_caja_mov_hist_branch_idx
  ON public.cortes_caja_movimientos_historial (branch_id, observado_at DESC);
CREATE INDEX IF NOT EXISTS cortes_caja_mov_hist_mov_idx
  ON public.cortes_caja_movimientos_historial (branch_id, erp_movimiento_id);
CREATE INDEX IF NOT EXISTS cortes_caja_mov_hist_corte_idx
  ON public.cortes_caja_movimientos_historial (corte_id);

ALTER TABLE public.cortes_caja_movimientos_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.cortes_caja_movimientos_historial;
CREATE POLICY bloqueo_global ON public.cortes_caja_movimientos_historial
  AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

-- Mismo alcance que los movimientos: quien ve los cortes de su sala ve su
-- historia; quien tiene alcance ALL, la de todas.
DROP POLICY IF EXISTS cortes_caja_mov_hist_select ON public.cortes_caja_movimientos_historial;
CREATE POLICY cortes_caja_mov_hist_select ON public.cortes_caja_movimientos_historial
  FOR SELECT TO authenticated
  USING (
    (SELECT auth_has_module_permission('cortes_caja','can_view'))
    AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
         OR branch_id = (SELECT auth_employee_branch_id()))
  );

-- Append-only y escrito sólo por la captura: sin policy de INSERT/UPDATE/DELETE
-- a propósito. Una bitácora que el navegador puede editar no es una bitácora.
REVOKE ALL ON public.cortes_caja_movimientos_historial FROM anon;
GRANT SELECT ON public.cortes_caja_movimientos_historial TO authenticated;
GRANT ALL    ON public.cortes_caja_movimientos_historial TO service_role;

COMMENT ON TABLE public.cortes_caja_movimientos_historial IS
  'Cada cambio OBSERVADO en un movimiento de caja del origen: apareció, se editó, desapareció. El origen no guarda historia; esto es lo único que queda de un movimiento borrado.';
