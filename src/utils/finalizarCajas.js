// Las cuentas de «Finalizar» un pedido en Bodega: cuántas cajas salen, qué
// hoja va en qué caja y qué renglones salen distinto de lo asignado.
//
// Vivían dentro de `FinalizarCajasModal` (portal). Salen al núcleo para que la
// app del teléfono arme EXACTAMENTE el mismo `caja_map`, `pagina_items` y
// ajuste de envío: la sala recibe por hoja y por caja, y dos maneras de
// repartirlas serían dos pedidos distintos para la misma recepción.

import { mapaDePresentaciones } from './recepcionDePedido';

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
 * Las presentaciones en que Bodega puede decir lo que sale de un renglón:
 * `[{ factor, label }]`, con la del renglón primero.
 *
 * Sólo las que se pueden escribir SIN redondear: las que son un múltiplo de la
 * del renglón (2 cajas de 10 sobre un renglón en unidades) y las que la
 * dividen (5 unidades sobre un renglón en cajas de 10 — ahí el renglón pasa a
 * esa presentación al confirmar, ver `confirmar_envio_pedido`). Una de 4 sobre
 * una de 10 no entra: no hay cuenta entera que la guarde.
 *
 * Nació de 5 tabletas que se escribieron en la casilla de un renglón en cajas
 * y se guardaron como 5 cajas (pedido #234, 2026-10-28): la casilla no decía
 * en qué estaba, y el traslado intentó mover 50.
 */
export function presentacionesDeEnvio(r) {
    const R = Number(r?.factor) || 1;
    const propia = { factor: R, label: r?.presentaciones?.tipo || (R === 1 ? 'UNIDAD' : `×${R}`) };
    const opts = [propia];
    const filas = (r?.products?.product_precios ?? [])
        .map(p => ({ ...p, product_id: r.erp_product_id }));
    for (const o of (mapaDePresentaciones(filas)[r?.erp_product_id] ?? [])) {
        if (o.factor === R || opts.some(x => x.factor === o.factor)) continue;
        if (o.factor % R === 0 || R % o.factor === 0) opts.push({ factor: o.factor, label: o.label });
    }
    return opts;
}

/**
 * Los ajustes de envío: sólo las EXCEPCIONES. `ajustes` es
 * `{ [pedido_item_id]: { cantidad, motivo, factor? } }`; `factor` es la
 * presentación en que se escribió `cantidad` (sin él, la del renglón). Uno
 * igual a lo asignado no cuenta.
 *
 * Sale en la presentación del renglón siempre que la cuenta dé entera; sólo
 * si no da (5 unidades de un renglón en cajas de 10) viaja con su `factor`, y
 * la base pasa el renglón a esa presentación.
 */
export function ajustesDeEnvio(ajustes = {}, items = []) {
    const despachables = despachablesDe(items);
    return Object.entries(ajustes)
        .map(([id, a]) => {
            const it = despachables.find(r => String(r.id) === String(id));
            if (!it) return null;
            const cant = Number(a.cantidad);
            if (!Number.isFinite(cant)) return null;
            const R = Number(it.factor) || 1;
            const f = Number(a.factor) || R;
            const unidades = cant * f;
            if (unidades === Number(it.cantidad_asignada) * R) return null;
            const motivo = a.motivo || null;
            if (unidades % R === 0) return { pedido_item_id: Number(id), cantidad_enviada: unidades / R, motivo };
            return { pedido_item_id: Number(id), cantidad_enviada: cant, factor: f, motivo };
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
