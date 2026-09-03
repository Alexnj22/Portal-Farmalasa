-- Cuándo se MIRÓ por última vez la lista de movimientos de cada sala.
--
-- ── Por qué no alcanza con `cortes_caja_movimientos.visto_at` ──────────────
-- Esa columna dice cuándo se confirmó que un movimiento SEGUÍA ahí, y por eso
-- no existe cuando no hay ninguno. «Todavía no miré hoy» y «miré y no había
-- nada» se ven idénticos: las dos son cero filas.
--
-- La diferencia importa porque de ella depende la cadencia. Con la marca puesta
-- en las filas, una sala cerrada un domingo —cero movimientos en todo el día—
-- pediría su lista al sistema de origen las 1.920 corridas de la ventana, que
-- es justo el gasto que la cadencia viene a evitar. Con esta tabla, pide 12 por
-- hora y ninguna más.
--
-- Una fila por sala y nada más: no es un log, es un reloj. Se pisa en cada
-- vistazo (`ON CONFLICT DO UPDATE`), así que no crece y no necesita purga —lo
-- que la saca de la regla de retención del día 1—.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cortes_caja_vistazos (
  branch_id   integer PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  mirado_el   timestamptz NOT NULL DEFAULT now(),
  encontrados integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cortes_caja_vistazos IS
  'Cuándo se le pidió por última vez al sistema de origen la lista de movimientos de cada sala, y cuántos trajo. Es el reloj de la cadencia de `sync-cortes-caja`: `cortes_caja_movimientos.visto_at` no sirve para eso porque no existe cuando no hay movimientos, y ahí «no miré» y «miré y no había» se ven iguales.';
COMMENT ON COLUMN public.cortes_caja_vistazos.encontrados IS
  'Cuántos movimientos trajo ese vistazo. Cero es un dato: significa que se miró y la sala no había movido nada.';

ALTER TABLE public.cortes_caja_vistazos ENABLE ROW LEVEL SECURITY;

-- La escribe el service_role desde la captura (salta el RLS). Para el navegador
-- es de sólo lectura, con el mismo permiso y el mismo alcance con el que se
-- miran los movimientos que explica.
DROP POLICY IF EXISTS cortes_caja_vistazos_select ON public.cortes_caja_vistazos;
CREATE POLICY cortes_caja_vistazos_select ON public.cortes_caja_vistazos
  FOR SELECT TO authenticated
  USING (
    (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
    AND (
      (SELECT auth_module_scope('cortes_caja')) = 'ALL'
      OR branch_id = (SELECT auth_employee_branch_id())
    )
  );
