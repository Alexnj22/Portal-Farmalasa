// ─── Sacar el ticket de un traslado por la caja de la sala ───────────────────
//
// El papel lo arma `trasladoTicket` (puro, con sus pruebas); esto es el efecto:
// elegir la caja y mandarlo. Están separados por lo mismo que `bolsaComprobante`
// y la pantalla que lo imprime — una función que devuelve un ticket se puede
// anclar en una prueba sin impresora ni sesión, y una que imprime no.
//
// ── NO LANZA. Nunca. ────────────────────────────────────────────────────────
// Para cuando esto corre, el producto YA se movió: el despacho terminó bien y
// la solicitud quedó en camino. Si el armado del papel o la cola fallaran y eso
// subiera como excepción, la pantalla mostraría un error sobre una operación
// que salió bien — y quien lo vea la va a volver a intentar, que es la peor
// consecuencia posible. Es la misma decisión que `avisarSalidaALasSalas`:
// primero se escribe el hecho, después se avisa, y el aviso no puede deshacerlo.
//
// El resultado se devuelve igual para que la pantalla pueda DECIR que el papel
// no salió, que no es lo mismo que no decir nada.

import { construirTicketDeTraslado } from './trasladoTicket';

/**
 * Imprime el ticket del traslado recién despachado.
 *
 * `sala` es la sala de quien está despachando —o sea dónde está la bolsa—, no
 * la sala dueña del producto: cuando una sala cubre a otra que está cerrada, la
 * caja tiene que ser la de quien la tiene en el mostrador. En la práctica sale
 * de `miBranch`, que es exactamente eso por construcción.
 *
 * Sin caja registrada, `imprimirDocumento` cae solo al diálogo del navegador —
 * que es hoy el caso de Bodega, pendiente de ticketera.
 *
 * @returns {Promise<{ok: boolean, via?: string, detalle?: string}>}
 */
export async function imprimirTicketDeTraslado({ sala, ...datos }) {
    try {
        // `ticketPrint` sólo hace falta cuando hay algo que imprimir, y esta
        // vista se abre muchas veces por cada vez que alguien despacha.
        const { imprimirDocumento } = await import('./ticketPrint');
        return await imprimirDocumento(construirTicketDeTraslado(datos), { sala });
    } catch (e) {
        console.error('imprimirTicketDeTraslado:', e);
        return { ok: false, detalle: 'No se pudo imprimir el ticket.' };
    }
}

/**
 * Lo que de verdad va en la bolsa, que no siempre es lo que se pidió.
 *
 * Un despacho puede salir recortado —«enviar lo que hay»— y entonces el papel
 * tiene que listar lo que VIAJA. Un ticket que repita lo pedido convierte al
 * papel en el documento que contradice a la bolsa, y como el que abre la bolsa
 * le cree al papel, la diferencia se reporta como faltante.
 *
 * @param items     los renglones guardados (`metadata.items`)
 * @param aceptadas `[{ i, cantidad }]` — vacío cuando sale todo lo pedido
 */
export function loQueVaEnLaBolsa(items = [], aceptadas = []) {
    const renglon = (nombre, cantidad) => ({ nombre, cantidad });
    if (!aceptadas.length) {
        return items.map(it => renglon(it?.descripcion, it?.cantidad));
    }
    return aceptadas.map(a => renglon(items[a.i]?.descripcion, a.cantidad));
}
