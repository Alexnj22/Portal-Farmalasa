SET lock_timeout = '5s';

/* ── QUIÉN SE LLEVA EL EFECTIVO SE IDENTIFICA, NO SE ESCRIBE ───────────────
 *
 * Pregunta del usuario (1-sep): «¿por qué raya de firma y no escanear el carné
 * o poner usuario y contraseña?». No hay motivo bueno — el papel salió con una
 * raya porque copié el criterio del vale de bolsa sin ver que ahí SÍ se
 * identifica, con `IdentidadDeQuienRetira` desde el 19-ago.
 *
 * Una raya en papel prueba que alguien escribió algo. El carné prueba QUIÉN, lo
 * resuelve el servidor, y deja el vale de un solo uso de `identidad_vales`:
 * cinco minutos, un solo consumo y verificado contra la persona. Un nombre
 * tecleado no se puede comprobar después; una firma en un papel que se archiva,
 * tampoco.
 *
 * ── Pero no todo el que recibe es empleado, y eso decide la columna ────────
 *
 * Un anticipo, una compra, una bonificación y un pago a proveedor se los lleva
 * alguien de la sala: ahí el carné es la respuesta exacta. Una **devolución a
 * un cliente** se la lleva el cliente, que no tiene carné — pedirle uno sería
 * pedir lo imposible, y poner el del empleado diría que el empleado se quedó
 * con el dinero.
 *
 * Por eso es una columna y no una regla global: `identifica_receptor` decide si
 * la pantalla abre el lector o pide un nombre. Y el papel cambia con ella —
 * quien quedó identificado NO firma (el registro ya lo prueba mejor), quien
 * sólo tiene nombre escrito sí, porque la firma es lo único que hay.
 */
ALTER TABLE public.caja_tipos_movimiento
    ADD COLUMN IF NOT EXISTS identifica_receptor boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.caja_tipos_movimiento.identifica_receptor IS
    'true = quien recibe es de la casa y se identifica con carné o usuario. false = es alguien de afuera y sólo se escribe su nombre.';

-- Los cuatro que se lleva alguien de la sala.
UPDATE public.caja_tipos_movimiento
   SET identifica_receptor = true, pide_persona = true
 WHERE codigo IN ('ANTICIPO', 'BONIFICACION', 'COMPRA', 'PAGO_PROVEEDOR');

/* `DEVOLUCION` y `OTRO_SALIDA` se quedan en texto: en la primera el receptor es
 * un cliente, y en la segunda no se sabe quién es —«otro» no tiene receptor
 * definido, y forzar un carné ahí convertiría la escotilla en un candado. */

-- Quién recibió, y cómo se comprobó. `recibido_metodo` sale del vale y NO del
-- navegador: es el propio vale el que sabe si fue carné o contraseña.
ALTER TABLE public.caja_movimientos_portal
    ADD COLUMN IF NOT EXISTS recibido_por uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS recibido_metodo text,
    -- El nombre escrito, para los tipos que no identifican. Vivía sólo en el
    -- concepto del sistema de la caja, o sea mezclado con el detalle.
    ADD COLUMN IF NOT EXISTS recibido_texto text;

CREATE INDEX IF NOT EXISTS caja_mov_portal_recibido_idx
    ON public.caja_movimientos_portal (recibido_por) WHERE recibido_por IS NOT NULL;
