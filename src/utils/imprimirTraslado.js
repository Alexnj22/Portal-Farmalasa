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
// consecuencia posible. Es la misma decisión que tomaban los avisos de salida de un pedido:
// primero se escribe el hecho, después se avisa, y el aviso no puede deshacerlo.
//
// El resultado se devuelve igual para que la pantalla pueda DECIR que el papel
// no salió, que no es lo mismo que no decir nada.

import { construirTicketDeTraslado } from './trasladoTicket';

const normLote = (s) => String(s ?? '').trim().toUpperCase();

/**
 * El vence de un lote cuando el despacho no lo guardó (filas anteriores al
 * 2026-11-06): se busca ESE número de lote entre los que reservó la solicitud.
 * Medido sobre 30 días: coincide en el 97% de los renglones con lote. Si el
 * despacho mandó otro lote, no se inventa uno: el papel dice el lote sin vence.
 */
function venceDelPedido(lotesPedidos, lote) {
    const n = normLote(lote);
    if (!n) return null;
    return (Array.isArray(lotesPedidos) ? lotesPedidos : [])
        .find((l) => normLote(l?.lote) === n && l?.vence)?.vence ?? null;
}

/**
 * Lo que VIAJÓ, con el lote y el vence de cada producto, a partir del detalle
 * del despacho (`erp_traslado.detalle`: un renglón por lote).
 *
 * Los renglones de un mismo producto y presentación se juntan en una fila: la
 * cantidad es la suma y cada lote queda debajo con la suya. El lote es el que
 * SALIÓ (`numero_lote`) — ése es «el correcto» —, y su vence el que guardó el
 * despacho; para las filas viejas, el del mismo lote en la solicitud.
 *
 * @param detalle       `erp_traslado.detalle`
 * @param itemsPedidos  `metadata.items` (de ahí sale el vence de respaldo)
 */
export function loQueViajo(detalle = [], itemsPedidos = []) {
    const filas = [];
    const porClave = new Map();
    for (const d of Array.isArray(detalle) ? detalle : []) {
        const clave = `${d?.erp_product_id ?? d?.descripcion}|${d?.presentacion ?? ''}`;
        let fila = porClave.get(clave);
        if (!fila) {
            fila = { nombre: d?.descripcion, cantidad: 0, lotes: [] };
            porClave.set(clave, fila);
            filas.push(fila);
        }
        const cantidad = Number(d?.cantidad) || 0;
        fila.cantidad += cantidad;
        if (d?.numero_lote) {
            const pedido = (itemsPedidos ?? []).find((it) => Number(it?.erp_product_id) === Number(d?.erp_product_id));
            fila.lotes.push({
                lote: d.numero_lote,
                vence: d?.vence || venceDelPedido(pedido?.lotes, d.numero_lote),
                cantidad,
            });
        }
    }
    return filas;
}

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
        // El papel no lleva título impreso —de dónde a dónde ya lo dicen sus
        // renglones—, así que la lista de la caja necesita uno propio: cinco
        // trabajos llamados «Documento» no dejan ver cuál no salió.
        const tituloDeCola = [
            datos?.familia === 'envio' ? 'ENVIO' : 'SOLICITUD',
            // El mismo número que va en las barras: el propio de la bolsa
            // cuando lo hay (el envío), y si no el del traslado.
            datos?.codigo || datos?.aplicado?.id_traslado,
            datos?.destino,
        ].filter(Boolean).join(' ');
        return await imprimirDocumento(
            construirTicketDeTraslado(datos), { sala, tituloDeCola },
        );
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
    // Sin el detalle del despacho, el lote que se sabe es el que se RESERVÓ:
    // sólo se pone cuando el renglón sale entero (recortado, no se sabe de cuál).
    const renglon = (nombre, cantidad, lotes, factor) => (lotes?.length
        ? { nombre, cantidad, lotes: lotes.map((l) => ({ lote: l?.lote, vence: l?.vence, cantidad: Number(l?.unidades) / (Number(factor) || 1) })) }
        : { nombre, cantidad });
    if (!aceptadas.length) {
        return items.map(it => renglon(it?.descripcion, it?.cantidad, it?.lotes, it?.factor));
    }
    return aceptadas.map(a => renglon(items[a.i]?.descripcion, a.cantidad));
}

/**
 * El MISMO ticket otra vez, cuando el papel no sirvió.
 *
 * Pedido del usuario (2026-08-24) después de que un ticket saliera demasiado
 * claro para el lector: «¿hay alguna forma de reimprimir una solicitud /
 * traslado ante un error de impresión?». Y con una condición suya: **sólo
 * imprimir**. No anula el papel anterior, no marca nada, no pide un motivo —
 * porque lo que se está arreglando es una impresora, no un hecho del negocio.
 *
 * ── Se REARMA, no se guarda ────────────────────────────────────────────────
 * No hay copia del ticket en ninguna parte, y no hace falta: todo lo que el
 * papel dice quedó en `metadata.erp_traslado` cuando el despacho entró —número,
 * quién despachó, la hora, y el `detalle` de lo que REALMENTE viajó—. Guardar
 * además el papel armado sería una segunda verdad que puede divergir de la
 * primera.
 *
 * **`detalle` y no `items`**: `items` es lo que se PIDIÓ, y un despacho puede
 * salir recortado. Un ticket reimpreso desde lo pedido diría más de lo que hay
 * en la bolsa, y como quien la abre le cree al papel, la diferencia se reporta
 * como faltante. `loQueVaEnLaBolsa` queda de respaldo para las filas viejas que
 * no traen `detalle`.
 *
 * @param metadata  el `metadata` de la fila (`approval_requests`)
 * @param pide      nombre de quien pidió — el papel lo lleva y tiene que decir
 *                  lo mismo que la primera vez
 * @param sala      a qué caja va. Es la de QUIEN REIMPRIME, no la del despacho:
 *                  quien aprieta el botón es quien va a levantar el papel.
 */
export function datosDelTicketGuardado(metadata, { pide = null, familia = 'solicitud' } = {}) {
    const erp = metadata?.erp_traslado ?? {};
    // Sin número no hay código de barras, y un ticket de traslado sin barras no
    // se puede confirmar escaneando — o sea que no sería el mismo papel. Se
    // devuelve `null` para que el llamador lo DIGA: el original ya avisaba
    // «SIN NUMERO», y ese traslado se confirma a mano.
    if (!erp.id_traslado) return null;

    /* `detalle` y NO `items`, y ésta es la parte que se puede equivocar en
     * silencio: `items` es lo que se PIDIÓ, y un despacho puede salir
     * recortado. Un ticket reimpreso desde lo pedido diría más de lo que hay en
     * la bolsa — y como quien la abre le cree al papel, la diferencia se
     * reporta como faltante. `loQueVaEnLaBolsa` queda de respaldo para las
     * filas viejas que no traen `detalle`. */
    const deDetalle = loQueViajo(erp.detalle, metadata?.items ?? []);

    return {
        familia,
        aplicado: {
            id_traslado: erp.id_traslado,
            by_name: erp.by_name,
            por_respaldo: erp.por_respaldo === true,
            at: erp.at,
        },
        origen: metadata?.origen_branch_name,
        destino: metadata?.branch_name,
        pide,
        items: deDetalle.length ? deDetalle : loQueVaEnLaBolsa(metadata?.items ?? []),
        motivo: metadata?.motivo,
    };
}

/**
 * Y el ticket de un ENVÍO, que no se arma con las mismas piezas.
 *
 * `datosDelTicketGuardado` lee `metadata.erp_traslado` — el movimiento del
 * traslado, con su número, quién despachó y cuándo. **Un envío no tiene ese
 * objeto**: cada renglón hizo su propio movimiento y los datos del despacho
 * viven en `envio_linea`. Lo que nombra a la bolsa entera es su código propio
 * (`codigo_bolsa`), y lo que lleva sale de sus renglones.
 *
 * Se imprime lo que SALIÓ, no lo que se compuso: un renglón que no pudo
 * despacharse no está en la caja, y un papel que lo liste manda a alguien a
 * buscar lo que no existe. Es la misma regla que `loQueVaEnLaBolsa` en la
 * solicitud.
 *
 * @param envio  la fila como la devuelve `envio_json` (lista, historial o
 *               escaneo — es la misma forma, escrita una sola vez)
 * @param quien  nombre de quien despacha, para el renglón «Envia». El envío no
 *               guarda un `by_name` a nivel bolsa: lo pone quien imprime.
 */
export function datosDelTicketDeEnvio(envio, { quien = null } = {}) {
    const lineas = Array.isArray(envio?.lineas) ? envio.lineas : [];
    // Salieron las que tienen fecha de salida. `estado` no sirve acá: para
    // cuando alguien reimprime, un renglón ya puede estar aceptado o devuelto y
    // sigue siendo lo que viajó en esa bolsa.
    const salidas = lineas.filter(l => l?.enviado_at);
    const cuales = salidas.length ? salidas : lineas;
    return {
        familia: 'envio',
        codigo: envio?.codigo_bolsa ?? '',
        aplicado: {
            by_name: quien ?? null,
            // La hora de la bolsa es la del primer renglón que salió: es cuando
            // la caja se armó, que es lo que el papel tiene que decir.
            at: cuales.map(l => l?.enviado_at).filter(Boolean).sort()[0] ?? envio?.created_at ?? null,
            por_respaldo: false,
        },
        origen: envio?.origen_branch_name,
        destino: envio?.branch_name,
        // Un envío no lo pidió nadie — ése es su significado — así que el
        // renglón «Pide» no se imprime.
        pide: '',
        // El lote que SALIÓ (`detalle.renglones`) con el vence que guardó el
        // despacho; para las filas viejas, el del mismo lote en la composición.
        items: cuales.map(l => {
            const renglones = Array.isArray(l?.detalle?.renglones) ? l.detalle.renglones : [];
            const lotes = renglones.length
                ? renglones.filter(r => r?.lote).map(r => ({
                    lote: r.lote,
                    vence: r?.vence || venceDelPedido(l?.lotes, r.lote),
                    cantidad: r?.cantidad,
                }))
                : (l?.lotes ?? []).map(r => ({ lote: r?.lote, vence: r?.vence, cantidad: Number(r?.unidades) / (Number(l?.factor) || 1) }));
            return { nombre: l?.descripcion, cantidad: l?.cantidad, lotes };
        }),
        motivo: envio?.motivo_tipo
            ? [envio.motivo_tipo, envio.reason && envio.reason !== envio.motivo_tipo ? envio.reason : null]
                .filter(Boolean).join(' — ')
            : (envio?.reason ?? null),
    };
}

/**
 * Imprime —o reimprime— el ticket de una bolsa de envío.
 *
 * Sin código no hay barras, y un ticket de bolsa sin barras no se puede
 * escanear al recibir: se devuelve el fallo para que la pantalla lo DIGA en vez
 * de sacar un papel mudo. En la práctica no debería pasar — el número lo pone
 * un trigger al crear el envío — pero una fila anterior a ese trigger existe.
 */
export async function imprimirTicketDeEnvio({ envio, sala, quien = null }) {
    const datos = datosDelTicketDeEnvio(envio, { quien });
    if (!datos.codigo) {
        return { ok: false, detalle: 'Esta bolsa no tiene número: se recibe buscándola en la lista.' };
    }
    return imprimirTicketDeTraslado({ sala, ...datos });
}

/**
 * El ticket de una bolsa de envío listo para mandar a la caja desde cualquier
 * cliente (el teléfono lo encola con su propio impresor) — la pareja de
 * `ticketParaReimprimir` para los envíos. `null` si la bolsa no tiene número:
 * sin barras no se puede escanear al recibir.
 *
 * @returns {{ ticket: object, titulo: string } | null}
 */
export function ticketDeEnvioParaImprimir({ envio, quien = null }) {
    const datos = datosDelTicketDeEnvio(envio, { quien });
    if (!datos.codigo) return null;
    const titulo = ['ENVIO', datos.codigo, datos.destino].filter(Boolean).join(' ');
    return { ticket: construirTicketDeTraslado(datos), titulo };
}

export async function reimprimirTicketDeTraslado({ metadata, pide, sala, familia = 'solicitud' }) {
    const datos = datosDelTicketGuardado(metadata, { pide, familia });
    if (!datos) {
        return { ok: false, detalle: 'Ese traslado no tiene número: su ticket se confirma a mano.' };
    }
    return imprimirTicketDeTraslado({ sala, ...datos });
}

/**
 * El ticket de un traslado guardado, listo para mandar a la caja de la sala
 * desde cualquier cliente (el teléfono lo encola con su propio impresor). `null`
 * si el traslado no tiene número: sin barras no es el mismo papel.
 *
 * @returns {{ ticket: object, titulo: string } | null}
 */
export function ticketParaReimprimir({ metadata, pide = null, familia = 'solicitud' }) {
    const datos = datosDelTicketGuardado(metadata, { pide, familia });
    if (!datos) return null;
    const titulo = [
        datos?.familia === 'envio' ? 'ENVIO' : 'SOLICITUD',
        datos?.codigo || datos?.aplicado?.id_traslado,
        datos?.destino,
    ].filter(Boolean).join(' ');
    return { ticket: construirTicketDeTraslado(datos), titulo };
}
