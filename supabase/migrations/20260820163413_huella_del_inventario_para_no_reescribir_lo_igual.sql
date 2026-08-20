SET lock_timeout = '5s';

-- La huella de lo último que el sistema entregó, por sucursal y área.
--
-- ── Para qué ─────────────────────────────────────────────────────────────────
-- El inventario se sincroniza **cada minuto** y así se queda: la sala necesita
-- ver existencias frescas. Lo que no hace falta es volver a escribir en la base
-- cuando el sistema devolvió exactamente lo mismo. Medido el 2026-08-20:
--
--     por hora viajan 844.028 filas y cambian 305 — una de cada 2.767
--
-- Con la huella, la corrida sigue preguntándole al sistema cada minuto —o sea
-- que la frescura no cambia— y sólo toca la base cuando hay algo distinto.
--
-- ── Por qué se puede confiar en una huella ───────────────────────────────────
-- Porque `sync_inventory_batch` es **el único** que escribe `inventory` en toda
-- la base (verificado sobre las funciones y sobre el código del portal: todo lo
-- demás lee). Si algo más la escribiera, la huella diría «igual» mientras la
-- copia se aleja, que es el peor final posible para esto.
--
-- Aun así lleva válvula: si la huella tiene más de 30 minutos, se sincroniza
-- igual. Cualquier deriva que aparezca por un camino que nadie previó se cura
-- sola en media hora, a costa de dos corridas completas por hora en vez de 60.
CREATE TABLE IF NOT EXISTS public.inventory_sync_huella (
    erp_sucursal_id integer     NOT NULL,
    is_vencidos     boolean     NOT NULL DEFAULT false,
    huella          text        NOT NULL,
    filas           integer     NOT NULL DEFAULT 0,
    -- Cuándo se escribió inventario por última vez con esta huella. Es lo que
    -- mira la válvula, no `created_at`.
    verificado_at   timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (erp_sucursal_id, is_vencidos)
);

ALTER TABLE public.inventory_sync_huella ENABLE ROW LEVEL SECURITY;

-- Sólo lectura para quien esté dentro del portal: es diagnóstico del sync, no
-- dato de negocio. Escribe únicamente el sync, con la llave de servicio.
DROP POLICY IF EXISTS inventory_sync_huella_select ON public.inventory_sync_huella;
CREATE POLICY inventory_sync_huella_select ON public.inventory_sync_huella
    FOR SELECT TO authenticated USING (true);
