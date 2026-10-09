/**
 * El conteo de un renglón de pedido al recibirlo en la sala: de lo que la
 * persona cuenta en la presentación de DESPACHO (caja de 12, blíster…) a lo que
 * se guarda en unidades del sistema, y qué diferencia es.
 *
 * Vivía dentro de `views/pedidos/RecepcionModal.jsx` (`buildPItems`, «Todo OK»
 * y dos funciones sueltas). Se mudó el 2026-10-01 con la recepción en la app:
 * contado distinto en el teléfono que en el portal, el mismo conteo quedaría
 * como faltante en uno y completo en el otro.
 */

/** Unidades del sistema → presentación de despacho (redondeado). */
export function toDispatch(qty, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return qty;
    return Math.round(qty * erpFactor / dispFactor);
}

/** Lo que salió de Bodega para este renglón, en unidades del sistema. */
export const enviadoDe = (r) => r?.cantidad_enviada ?? r?.cantidad_asignada ?? 0;

/** Lo que se espera ver, en la presentación de despacho. */
export function esperadoEnDespacho(r) {
    const erpFactor = Number(r.factor) || 1;
    const dispFactor = Number(r.dispatch_factor) || erpFactor;
    return toDispatch(enviadoDe(r), erpFactor, dispFactor);
}

/**
 * Una cantidad en unidades del sistema, dicha en la presentación de despacho
 * SI CABE EXACTA, y en la unidad del sistema si no. Devuelve `{ fQty, fPres }`
 * —cuántas y de qué factor—, que es la forma en que la pantalla cuenta.
 *
 * Existe por el redondeo. Bodega puede asignar 25 de un producto que se
 * despacha en blíster de 10: «2.5 blísteres» se redondeaba a 3, la casilla
 * arrancaba en 3 y, sin que nadie tocara nada, el renglón ya decía «+5». Y
 * «Todo OK» guardaba 30 recibido sin diferencia sobre 25 enviados (con 24,
 * guardaba 20). Ofreciendo la unidad cuando no cabe exacta, el valor inicial
 * es lo enviado, al número.
 */
export function enPresentacion(cantidad, r) {
    const erpFactor = Number(r?.factor) || 1;
    const dispFactor = Number(r?.dispatch_factor) || erpFactor;
    const n = Number(cantidad) || 0;
    if (dispFactor === erpFactor) return { fQty: n, fPres: dispFactor };
    const enDespacho = n * erpFactor / dispFactor;
    if (Math.abs(enDespacho - Math.round(enDespacho)) < 1e-9) return { fQty: Math.round(enDespacho), fPres: dispFactor };
    return { fQty: n, fPres: erpFactor };
}

/** Con qué arranca el conteo de un renglón: lo enviado, sin inventar diferencia. */
export const conteoInicial = (r) => enPresentacion(enviadoDe(r), r);

/**
 * El renglón tal como llegó: sin diferencia. Guarda lo enviado AL NÚMERO —ver
 * `enPresentacion`: pasar por la presentación de despacho lo redondeaba—.
 */
export function renglonTodoOk(r) {
    return { pedido_item_id: r.id, cantidad_recibida: enviadoDe(r), nota_diferencia: null, error_tipo: null, cantidad_problema: null };
}

/**
 * ¿La recepción de esta sala quedó TERMINADA, o sólo se contó lo que llegó?
 *
 * «Terminé» lo decían cinco caminos del modal de recepción y cada uno lo
 * contestaba a su manera: la caja especial, «Confirmar todo» y «Finalizar»
 * miraban si quedaban cajas en reenvío; cerrar la última hoja y el pedido sin
 * hojas mandaban `true` a secas. Con una caja que no llegó, contar la última
 * hoja dejaba la sala Completada — y la caja, cuando llegara, ya no tenía
 * dónde contarse. Una sola respuesta para los cinco.
 *
 * @param {{ hojasPorContar?: number, especialesPorContar?: number,
 *           cajasQueNoLlegaron?: number[], hayRenglonesEnReenvio?: boolean,
 *           hojasPorRevisar?: number }} estado
 */
export function quedaTodoListo({
    hojasPorContar = 0, especialesPorContar = 0, cajasQueNoLlegaron = [],
    hayRenglonesEnReenvio = false, hojasPorRevisar = 0,
} = {}) {
    return hojasPorContar === 0
        && especialesPorContar === 0
        && hojasPorRevisar === 0
        && (cajasQueNoLlegaron?.length ?? 0) === 0
        && !hayRenglonesEnReenvio;
}

/** El rótulo de una presentación: «CAJA X 10», o el factor si no hay más. */
export function etiquetaDePresentacion(p) {
    const f = Number(p?.factor) || 1;
    const tipo = p?.presentaciones?.tipo || '';
    const det = p?.descripcion || '';
    return tipo ? `${tipo}${det ? ' ' + det : ''}` : det || (f === 1 ? 'Unidad' : `×${f}`);
}

/**
 * `{ product_id: [{ factor, label }] }` a partir de filas de `product_precios`
 * (activas), una opción por factor, en orden de factor.
 */
export function mapaDePresentaciones(filas) {
    const map = {};
    [...(filas ?? [])]
        .filter(p => p && p.activo !== false)
        .sort((a, b) => (Number(a.factor) || 1) - (Number(b.factor) || 1))
        .forEach(p => {
            const pid = p.product_id;
            if (pid == null) return;
            const f = Number(p.factor) || 1;
            if (!map[pid]) map[pid] = [];
            if (!map[pid].some(x => x.factor === f)) map[pid].push({ factor: f, label: etiquetaDePresentacion(p) });
        });
    return map;
}

/**
 * Las presentaciones armadas desde los renglones mismos, que ya traen
 * `products.product_precios`. Así no hace falta otra consulta con un `.in()`
 * de mil ids en la URL. Devuelve `null` si a los renglones les falta algo para
 * armar el rótulo igual que la consulta aparte (la `descripcion`): un rótulo
 * distinto del de siempre confunde más que lo que ahorra.
 */
export function presentacionesDeRenglones(rows) {
    const filas = [];
    for (const r of rows ?? []) {
        const precios = r?.products?.product_precios;
        if (!Array.isArray(precios)) return null;
        for (const p of precios) {
            if (!p || !('descripcion' in p)) return null;
            filas.push({ ...p, product_id: r.erp_product_id });
        }
    }
    return mapaDePresentaciones(filas);
}

/**
 * El renglón contado. `fQty`/`fPres` = cuántas y de qué presentación (factor);
 * `problema` = 'danado' | 'vencido' | 'otro' | null (la persona marcó que algo
 * vino mal); `cantProblema` = cuántas de ésas. Sin `fQty`, lo esperado.
 *
 * Si la cantidad no cuadra con lo enviado, el tipo sale solo (faltante o
 * sobrante) salvo que la persona haya dicho cuál: lo que ELIGE gana, excepto
 * «otro» con una cantidad distinta, que se nombra por la cuenta.
 *
 * @param {object} r
 * @param {{ fQty?: number, fPres?: number, problema?: string | null,
 *           nota?: string | null, cantProblema?: number | null }} [contado]
 */
export function renglonContado(r, { fQty, fPres, problema = null, nota = null, cantProblema = null } = {}) {
    const erpFactor = Number(r.factor) || 1;
    const dispFactor = Number(r.dispatch_factor) || erpFactor;
    const enviado = enviadoDe(r);
    // Sin conteo escrito, lo enviado tal cual (ver `conteoInicial`). Con una
    // cantidad y sin presentación, la cantidad viene en la de DESPACHO —así
    // cuenta la app, que sólo manda `fQty`—.
    const ini = conteoInicial(r);
    const qty = fQty ?? ini.fQty;
    const pres = fPres ?? (fQty != null ? dispFactor : ini.fPres);
    const hasProb = !!problema;
    const fRaw = Math.round(qty * pres / erpFactor);
    const isDiff = fRaw !== enviado || hasProb;
    let error_tipo = null;
    if (isDiff) {
        if (problema && (problema !== 'otro' || fRaw === enviado)) error_tipo = problema;
        else if (fRaw < enviado) error_tipo = 'faltante';
        else if (fRaw > enviado) error_tipo = 'sobrante';
        else error_tipo = 'otro';
    }
    const cantidad_problema = (error_tipo === 'danado' || error_tipo === 'vencido') ? (cantProblema ?? 1) : null;
    return { pedido_item_id: r.id, cantidad_recibida: fRaw, nota_diferencia: nota || null, error_tipo, cantidad_problema };
}
