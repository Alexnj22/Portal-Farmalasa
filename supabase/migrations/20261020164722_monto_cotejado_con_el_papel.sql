SET lock_timeout = '5s';

-- Un monto que la foto no comprobó ya no se anota sin que alguien lo mire.
--
-- Regla del usuario (2026-10-20), sobre un POS Promerica de $19.87 que quedó
-- «monto sin comprobar» para siempre: el formulario avisaba con una línea gris
-- y dejaba anotar igual. Hoy pide primero otra foto con la boleta entera y,
-- si tampoco se comprueba, exige marcar «lo comparé con el papel».
--
--   FOTO_COTEJADA  se leyó de la foto, el papel no lo repetía (o la foto no lo
--                  dejó ver dos veces) y quien lo anotó declaró haberlo
--                  comparado con el papel. Lo firma `registrado_por`.
--
-- Lo decide `origenDelMonto` en operar-caja: la declaración sólo se acepta si
-- el monto guardado es el leído y no estaba confirmado.
ALTER TABLE public.caja_movimientos_portal
    DROP CONSTRAINT IF EXISTS caja_mov_monto_origen_valido;
ALTER TABLE public.caja_movimientos_portal
    ADD CONSTRAINT caja_mov_monto_origen_valido
    CHECK (monto_origen IS NULL
           OR monto_origen IN ('FOTO_CONFIRMADA', 'FOTO_SIN_CONFIRMAR', 'FOTO_COTEJADA', 'A_MANO'))
    NOT VALID;
ALTER TABLE public.caja_movimientos_portal
    VALIDATE CONSTRAINT caja_mov_monto_origen_valido;

COMMENT ON COLUMN public.caja_movimientos_portal.monto_origen IS
    'De dónde salió el monto: FOTO_CONFIRMADA (el papel lo repite y coincide), FOTO_SIN_CONFIRMAR (leído pero sin segundo renglón que lo respalde), FOTO_COTEJADA (leído sin comprobar y comparado con el papel por quien lo anotó), A_MANO (lo escribió una persona). Lo deriva operar-caja de la lectura.';
