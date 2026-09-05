SET lock_timeout = '5s';

-- Qué leyó la máquina de la foto, guardado junto al movimiento del cajón.
--
-- `bolsas_operaciones` ya lo hacía (`foto_lectura`, con su
-- `guardar_lectura_de_boleta`) y el cajón no. La consecuencia salió a la luz el
-- 2026-09-05: la boleta 018540 de Salud 4 dice **US$240.50** —dos veces, y la
-- impresora escribe el cero con una barra diagonal `Ø` que a la resolución en
-- que la foto viaja se confunde con un 8— y el lector puso **248.50**. La ÚNICA
-- evidencia de esa lectura es la frase que una persona escribió a mano al pedir
-- la corrección: «por error el sistema puso 248.50».
--
-- Sin rastro no se puede contar cuántas veces falla, o sea que tampoco se puede
-- saber si algo lo mejoró — y ese es justamente el trabajo que empieza hoy.
--
-- `jsonb` y no columnas: lo que el lector devuelve cambia con el prompt, y una
-- columna por campo obligaría a una migración cada vez que se le pregunta algo
-- nuevo. Nadie filtra por adentro; se lee entero cuando se audita una lectura.
ALTER TABLE public.caja_movimientos_portal
    ADD COLUMN IF NOT EXISTS foto_lectura jsonb;

COMMENT ON COLUMN public.caja_movimientos_portal.foto_lectura IS
    'Lo que devolvió leer-boleta para la foto de este movimiento: {leido, coincide, veredicto, montoConfianza}. Auditoría de la lectura automática — sin esto, un monto mal leído no deja rastro.';
