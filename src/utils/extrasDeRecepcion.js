// Lo que llegó y NO venía en el pedido (los «extras»), y cómo se rotula una
// presentación de despacho — compartido por la recepción del portal
// (`RecepcionModal`) y la del teléfono.
//
// Un extra nace como un RENGLÓN del pedido con `error_tipo = 'sobrante'`
// (`agregar_extra_a_pedido`), así que la lista se siembra de lo que ya está
// anotado: reabrir la pantalla lo encuentra.

import { conteoInicial, etiquetaDePresentacion } from './recepcionDePedido';
import { lotesAsignadosToDispatch } from './papelDePedido';

const PRES_DE_DESPACHO = { CAJA: 'Caja', BLISTER: 'Blíster', MULTIPLO: 'Unid', UNIDAD: 'Unidad', caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja', unidad: 'Unidad' };

/** «Caja ×12», «Blíster», «Unidad»… */
export function rotuloDeDespacho(dispatchTipo, dispatchFactor) {
    const f = Number(dispatchFactor) || 1;
    const label = PRES_DE_DESPACHO[dispatchTipo] ?? dispatchTipo ?? 'Unidad';
    return f > 1 ? `${label} ×${f}` : label;
}

/** Las presentaciones activas de un producto, una por factor, con su rótulo. */
export function opcionesDelCatalogo(precios = []) {
    const opts = [];
    for (const p of precios) {
        const f = Number(p.factor) || 1;
        if (!opts.find(x => x.factor === f)) opts.push({ factor: f, label: etiquetaDePresentacion(p) });
    }
    return opts;
}

export function opcionesDeExtra(opciones = [], ultimoDespacho = null) {
    const out = [...opciones];
    if (ultimoDespacho) {
        const df = Number(ultimoDespacho.dispatch_factor) || 1;
        if (!out.find(o => o.factor === df)) out.unshift({ factor: df, label: rotuloDeDespacho(ultimoDespacho.dispatch_tipo, df) });
    }
    return out;
}

/** Los extras ya anotados en los renglones del pedido. */
export const extrasDeRenglones = (rows = []) => rows
    .filter(r => r.es_extra && r.status !== 'anulado')
    .map(r => ({
        id: r.id,
        erp_product_id: r.erp_product_id,
        nombre: r.products?.nombre ?? '',
        fPres: Number(r.dispatch_factor) || Number(r.factor) || 1,
        fQty: Number(r.cantidad_recibida) || 1,
        nota: r.nota_diferencia ?? '',
        // Con una propuesta en curso, la cantidad es la que aceptó la otra parte.
        bloqueado: r.resolucion_status != null,
        // Pero se puede QUITAR mientras bodega no contestó: todavía no se movió
        // nada. Sin esto, un extra anotado con el producto equivocado quedaba
        // trabado y lo único que había para apretar era aceptar el error
        // (pedido 07-201026-2-S1, 2026-10-21). La base aplica la misma regla.
        retirable: r.resolucion_status == null || r.resolucion_status === 'propuesta',
    }));

// ── Lo que se le muestra al renglón que se cuenta (2026-10-15) ──────────────
// Mudado de `RecepcionModal` para que la app cuente con las MISMAS opciones y
// muestre los mismos lotes.

/**
 * Las presentaciones que se le pueden poner a un renglón, con la del despacho
 * primero. `presMap` = id de producto → [{ factor, label }]
 * (`presentacionesDeRenglones` / `mapaDePresentaciones`). `incluir`: factores
 * que TIENEN que estar aunque el catálogo no los traiga — la unidad del
 * sistema cuando lo enviado no cabe exacto en la presentación de despacho.
 */
export function opcionesDePresentacionDeRenglon(r, presMap = {}, incluir = []) {
    const erpFactor  = Number(r.factor) || 1;
    const dispFactor = Number(r.dispatch_factor) || erpFactor;
    const dispOpt    = { factor: dispFactor, label: rotuloDeDespacho(r.dispatch_tipo, dispFactor) };
    const vistos = new Set();
    const opts = [];
    if (r.dispatch_tipo && dispFactor !== erpFactor) { opts.push(dispOpt); vistos.add(dispFactor); }
    (presMap?.[r.erp_product_id] ?? []).forEach((o) => {
        if (!vistos.has(o.factor)) { opts.push(o); vistos.add(o.factor); }
    });
    if (!opts.length) { opts.push(dispOpt); vistos.add(dispFactor); }
    [conteoInicial(r).fPres, ...incluir].forEach((f) => {
        if (!vistos.has(f)) { opts.push({ factor: f, label: rotuloDeDespacho('UNIDAD', f) }); vistos.add(f); }
    });
    return opts;
}

/**
 * Los lotes que DEBEN venir en un renglón (`lotes_asignados`, lo que Bodega
 * calculó al generar), en la presentación de despacho: `[{ lote, fecha_vencimiento, take }]`.
 * «Deben venir», no «vinieron»: nadie confirma cuáles salieron.
 */
export function lotesQueDebenVenir(row) {
    const crudos = Array.isArray(row?.lotes_asignados) ? row.lotes_asignados : [];
    if (!crudos.length) return [];
    const erpFactor  = Number(row.factor) || 1;
    const dispFactor = Number(row.dispatch_factor) || erpFactor;
    return lotesAsignadosToDispatch(crudos, erpFactor, dispFactor);
}
