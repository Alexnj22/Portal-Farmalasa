SET lock_timeout = '5s';

-- ── La foto del comprobante tiene TRES estados, no dos ──────────────────────
-- «Se puede pedir la foto» resultó ser una pregunta de grado, igual que
-- `alcance_escritura_ficha`: la remesa SIEMPRE deja boleta del POS, pero un
-- proveedor «a veces no deja el DTE» (usuario, 2026-08-19) y una compra urgente
-- todavía no ocurrió cuando el dinero sale de la bolsa. Con un booleano las dos
-- salidas eran imposibles de registrar o quedaban sin ninguna prueba.
--
-- Una columna con tres valores y no dos booleanos: `pide_foto=true` +
-- `permite_foto=false` es un estado que no significa nada y que igual se puede
-- escribir.
ALTER TABLE public.bolsas_tipos_salida
    ADD COLUMN foto text NOT NULL DEFAULT 'NO'
    CHECK (foto IN ('NO', 'OPCIONAL', 'OBLIGATORIA'));

UPDATE public.bolsas_tipos_salida
   SET foto = CASE WHEN pide_foto THEN 'OBLIGATORIA' ELSE 'NO' END;

ALTER TABLE public.bolsas_tipos_salida DROP COLUMN pide_foto;

COMMENT ON COLUMN public.bolsas_tipos_salida.foto IS
    'NO = el campo ni se dibuja · OPCIONAL = se ofrece y no frena · OBLIGATORIA = sin foto no se registra.';

-- ── Qué pide cada motivo (usuario, 2026-08-19) ──────────────────────────────
--
-- REMESA se queda como está: es la única que pasa por el POS, así que es la
-- única con número de boleta y con foto obligatoria.
--
-- PAGO A PROVEEDOR: «no lleva número de boleta, porque no es por POS. foto del
-- comprobante tampoco porque a veces no deja el DTE, que sea opcional la foto.
-- quien se lleva el efectivo no debe salir, porque no es de la empresa». Ese
-- último es el cambio de fondo: el cobrador del proveedor no tiene cuenta en el
-- portal, así que pedirle carné o contraseña era pedir algo que no existe — y
-- con el formulario viejo el pago no se podía registrar de ninguna manera.
UPDATE public.bolsas_tipos_salida
   SET pide_boleta = false, foto = 'OPCIONAL', pide_receptor = false
 WHERE codigo = 'PAGO_PROVEEDOR';

-- GASTO, ANTICIPO y OTRO: los tres se los lleva alguien de la casa, así que los
-- tres identifican a esa persona. Sin boleta (no pasan por el POS) y con la
-- foto ofrecida pero no exigida: cuando el efectivo sale, la compra todavía no
-- se hizo y el comprobante no existe.
UPDATE public.bolsas_tipos_salida
   SET pide_boleta = false, foto = 'OPCIONAL', pide_receptor = true
 WHERE codigo IN ('GASTO', 'ANTICIPO', 'OTRO');

-- ── Tres motivos que salen de la lista ──────────────────────────────────────
-- `activo = false` y no DELETE: el catálogo tiene esa columna justamente para
-- esto, y un motivo borrado se lleva puesto el nombre de cualquier salida
-- histórica que lo hubiera usado. Hoy no hay ninguna (medido: las 6 operaciones
-- que existen son REMESA), pero la fila es lo que explica un folio viejo.
--
-- ENVIO_SALA: «envío de efectivo a otra sala no es opción. quitala.»
--
-- REINTEGRO: «quitalo, para eso existe la anulación de vales». Es exactamente
-- así — `anular_salida_de_bolsa` marca los movimientos y el saldo vuelve solo.
-- Registrar la vuelta como un movimiento NUEVO dejaba la salida original en pie
-- y la bolsa con dos papeles que se cancelan, en vez de con ninguno.
--
-- CAMBIO_SENCILLO: no movía el saldo (cambiar un billete por monedas deja la
-- misma plata adentro), pero el caso real es otro: «a veces sí se saca dinero
-- para cambiar monedas, pero no vuelve ese dinero a la bolsa». Eso es una
-- salida con monto, no una apertura de neto cero, y dejarlo en la lista invita
-- a registrar como «no pasó nada» un dinero que sí se fue.
UPDATE public.bolsas_tipos_salida
   SET activo = false
 WHERE codigo IN ('ENVIO_SALA', 'REINTEGRO', 'CAMBIO_SENCILLO');
