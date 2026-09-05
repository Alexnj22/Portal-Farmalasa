SET lock_timeout = '5s';

-- De dónde salió el monto: del papel comprobado, o de alguien.
--
-- Regla del usuario (2026-09-05), después de que una lectura pusiera 248.50
-- sobre una boleta que dice 240.50: «si no está seguro el resultado, debe
-- decirlo y permitir poner el monto manualmente y marcarlo».
--
-- Las dos primeras mitades viven en el formulario —el campo no se cierra si el
-- papel no confirma el número, y el aviso lo dice—. Ésta es la tercera: que
-- quede MARCADO en la fila, porque un monto que nadie pudo comprobar y uno
-- confirmado por el papel dos veces se ven idénticos una vez guardados, y la
-- diferencia es justamente la que hace falta al revisar un corte.
--
--   FOTO_CONFIRMADA    la boleta imprime el total más de una vez y lo guardado
--                      coincide con lo leído: el papel se confirma a sí mismo
--   FOTO_SIN_CONFIRMAR se leyó de la foto, pero el papel sólo lo dice una vez,
--                      así que nadie más que el lector lo respalda
--   A_MANO             lo guardado no es lo que el lector leyó, o no hubo
--                      lectura de monto: lo escribió una persona
--
-- Lo DERIVA el servidor comparando el monto guardado contra la lectura que ya
-- recibe, nunca lo declara el navegador: una marca de auditoría que el cliente
-- puede elegir no es una marca, es una opinión. `null` son las filas anteriores
-- a hoy y las que se anotan sin foto.
ALTER TABLE public.caja_movimientos_portal
    ADD COLUMN IF NOT EXISTS monto_origen text;

DO $$
BEGIN
    ALTER TABLE public.caja_movimientos_portal
        ADD CONSTRAINT caja_mov_monto_origen_valido
        CHECK (monto_origen IS NULL
               OR monto_origen IN ('FOTO_CONFIRMADA', 'FOTO_SIN_CONFIRMAR', 'A_MANO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.caja_movimientos_portal.monto_origen IS
    'De dónde salió el monto: FOTO_CONFIRMADA (el papel lo repite y coincide), FOTO_SIN_CONFIRMAR (leído pero sin segundo renglón que lo respalde), A_MANO (lo escribió una persona). Lo deriva operar-caja de la lectura; el navegador no lo declara.';
