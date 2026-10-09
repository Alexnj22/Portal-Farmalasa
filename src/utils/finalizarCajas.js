// Las cuentas de «Finalizar» un pedido en Bodega: cuántas cajas salen, qué
// hoja va en qué caja y qué renglones salen distinto de lo asignado.
//
// Vivían dentro de `FinalizarCajasModal` (portal). Salen al núcleo para que la
// app del teléfono arme EXACTAMENTE el mismo `caja_map`, `pagina_items` y
// ajuste de envío: la sala recibe por hoja y por caja, y dos maneras de
// repartirlas serían dos pedidos distintos para la misma recepción.

/** Lo que de verdad sale: lo que la bodega no pudo cubrir nunca estuvo en la caja. */
export const despachablesDe = (items = []) =>
    items.filter(r => !r.sin_stock && (r.cantidad_asignada ?? 0) > 0);

/** Cuántas cajas: siempre al menos una. */
export const cuantasCajas = (texto) => Math.max(1, parseInt(texto, 10) || 1);

/**
 * El reparto inicial hoja → caja: con más cajas que hojas, una por caja; con
 * menos, las hojas en orden se reparten parejas. Cada hoja es una LISTA de
 * cajas porque una hoja larga puede ir partida en dos.
 */
export function asignacionInicial(totalHojas, cajas) {
    return Array.from({ length: totalHojas }, (_, i) => [
        cajas >= totalHojas ? i + 1 : Math.floor((i * cajas) / totalHojas) + 1,
    ]);
}

/** Marca o desmarca una caja en una hoja; una hoja nunca se queda sin caja. */
export function alternarCaja(asignacion, hoja, caja) {
    const next = asignacion.map(a => [...a]);
    const cur = next[hoja] ?? [];
    if (cur.includes(caja)) {
        if (cur.length === 1) return next;
        next[hoja] = cur.filter(b => b !== caja);
    } else {
        next[hoja] = [...cur, caja].sort((a, b) => a - b);
    }
    return next;
}

export const asignacionCompleta = (asignacion, totalHojas) =>
    asignacion.length === totalHojas && asignacion.every(a => a.length > 0);

/** `{ "1": [1, 2], "2": [3] }` — qué hojas lleva cada caja. */
export function armarCajaMap(asignacion, cajas) {
    const cajaMap = {};
    for (let i = 1; i <= cajas; i++) cajaMap[String(i)] = [];
    asignacion.forEach((boxes, idx) => {
        boxes.forEach(b => {
            if (!cajaMap[String(b)]) cajaMap[String(b)] = [];
            cajaMap[String(b)].push(idx + 1);
        });
    });
    return cajaMap;
}

/** `{ "1": [ids…] }` — qué renglones lleva cada hoja. */
export function armarPaginaItems(hojas = []) {
    const out = {};
    hojas.forEach((pg, idx) => { out[String(idx + 1)] = pg.ids; });
    return out;
}

/**
 * Los ajustes de envío: sólo las EXCEPCIONES. `ajustes` es
 * `{ [pedido_item_id]: { cantidad, motivo } }`; uno igual a lo asignado no cuenta.
 */
export function ajustesDeEnvio(ajustes = {}, items = []) {
    const despachables = despachablesDe(items);
    return Object.entries(ajustes)
        .map(([id, a]) => {
            const it = despachables.find(r => String(r.id) === String(id));
            if (!it) return null;
            const cant = Number(a.cantidad);
            if (!Number.isFinite(cant) || cant === Number(it.cantidad_asignada)) return null;
            return { pedido_item_id: Number(id), cantidad_enviada: cant, motivo: a.motivo || null };
        })
        .filter(Boolean);
}

/**
 * Lo que el simulacro del traslado no pudo resolver arranca en CERO: mandarlo
 * igual hace fallar el traslado entero. Queda editable; no pisa lo que quien
 * despacha ya tocó (eso lo hace quien llama, mezclando encima).
 */
export function ajustesDelSimulacro(simu, items = []) {
    if (simu?.estado !== 'verificado') return {};
    const porProducto = new Map(items.map(i => [Number(i.erp_product_id), i]));
    const nuevos = {};
    for (const h of (simu.hallazgos ?? [])) {
        const it = porProducto.get(Number(h.erp_product_id));
        if (it) nuevos[it.id] = { cantidad: 0, motivo: String(h.detalle ?? h.codigo ?? '').slice(0, 160) };
    }
    return nuevos;
}
