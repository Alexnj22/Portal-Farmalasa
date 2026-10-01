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

/** El renglón tal como llegó: sin diferencia. */
export function renglonTodoOk(r) {
    const erpFactor = Number(r.factor) || 1;
    const dispFactor = Number(r.dispatch_factor) || erpFactor;
    const rawQty = Math.round(toDispatch(enviadoDe(r), erpFactor, dispFactor) * dispFactor / erpFactor);
    return { pedido_item_id: r.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null };
}

/**
 * El renglón contado. `fQty`/`fPres` = cuántas y de qué presentación (factor);
 * `problema` = 'danado' | 'vencido' | 'otro' | null (la persona marcó que algo
 * vino mal); `cantProblema` = cuántas de ésas. Sin `fQty`, lo esperado.
 *
 * Si la cantidad no cuadra con lo enviado, el tipo sale solo (faltante o
 * sobrante) salvo que la persona haya dicho cuál: lo que ELIGE gana, excepto
 * «otro» con una cantidad distinta, que se nombra por la cuenta.
 */
export function renglonContado(r, { fQty, fPres, problema = null, nota = null, cantProblema = null } = {}) {
    const erpFactor = Number(r.factor) || 1;
    const dispFactor = Number(r.dispatch_factor) || erpFactor;
    const enviado = enviadoDe(r);
    const qty = fQty ?? toDispatch(enviado, erpFactor, dispFactor);
    const pres = fPres ?? dispFactor;
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
