SET lock_timeout = '5s';

-- Dos correcciones del catálogo, las dos del usuario (2026-09-01).

/* 1 · «Abono a un credito» NO es un ingreso que alguien anote.
 *
 * «Ese sí se hace desde el sistema automáticamente al abonar una venta al
 * crédito.» Los 101 movimientos que la medición encontró son de cuando se
 * anotaba a mano; ofrecerlo hoy invita a anotar DOS VECES el mismo dinero —el
 * que la venta al crédito ya registró sola y el que alguien teclea acá—, y un
 * ingreso duplicado sobra en el corte sin que nada lo delate.
 *
 * Se DESACTIVA, no se borra: es una fila de catálogo y los movimientos que
 * lleguen a apuntarle tienen que poder seguir diciendo qué fueron. */
UPDATE public.caja_tipos_movimiento SET activo = false WHERE codigo = 'ABONO_CREDITO';

/* 2 · «Pago de un recibo» era el nombre del acto; el que la sala reconoce es el
 * APARATO: «POS Promerica». Y la causa —CAESS, ANDA, el teléfono— no se elige
 * de una lista: se lee de la boleta que el aparato imprime, que es la misma que
 * ya se fotografía. Por eso la foto pasa a OBLIGATORIA: sin ella no hay de
 * dónde sacar ni el monto, ni el número, ni de qué era el pago.
 *
 * El código cambia con el rótulo porque `PAGO_SERVICIO` describía otra cosa. Se
 * puede borrar sin cuidado: `caja_movimientos_portal.tipo_codigo` no tiene ni
 * una fila todavía —el catálogo nació hoy—, así que no hay a quién dejar
 * huérfano. El día que las haya, esto sería un UPDATE de las dos tablas. */
DELETE FROM public.caja_tipos_movimiento WHERE codigo = 'PAGO_SERVICIO';

INSERT INTO public.caja_tipos_movimiento
    (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden)
VALUES
    ('POS_PROMERICA', 'POS Promerica', 'ENTRADA', true, false, 'OBLIGATORIA', false,
     'La foto de la boleta llena el monto, el numero y de que fue el pago.', 60)
ON CONFLICT (codigo) DO UPDATE SET
    etiqueta = EXCLUDED.etiqueta, sentido = EXCLUDED.sentido,
    pide_boleta = EXCLUDED.pide_boleta, pide_persona = EXCLUDED.pide_persona,
    foto = EXCLUDED.foto, leyenda = EXCLUDED.leyenda, orden = EXCLUDED.orden,
    activo = true;
