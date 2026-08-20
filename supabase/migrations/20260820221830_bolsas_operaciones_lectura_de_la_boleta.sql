SET lock_timeout = '5s';

-- Qué se leyó de la foto del comprobante, y qué dijo el cruce contra lo que la
-- persona escribió (entidad, número de boleta, monto).
--
-- Se guarda aunque la salida sólo entre cuando el veredicto es OK: el registro
-- es lo que le permite a administración, al contar el dinero, ver POR QUÉ el
-- portal dio por buena esa boleta — y es lo único que va a decir, el día que
-- una pase mal, si el modelo leyó otra cosa o si la regla la dejó pasar. Un
-- control automático sin rastro de su decisión no se puede auditar.
--
-- `jsonb` y no columnas sueltas: es la respuesta de un lector que puede cambiar
-- de forma, no un dato del negocio. Lo que manda para el circuito sigue siendo
-- `entidad` / `numero_boleta` / `monto`, que los escribe una persona.
ALTER TABLE public.bolsas_operaciones
    ADD COLUMN IF NOT EXISTS foto_lectura jsonb;

COMMENT ON COLUMN public.bolsas_operaciones.foto_lectura IS
    'Lectura automática de la foto del comprobante: {leido, coincide, veredicto}. Rastro del control, no dato del negocio.';
