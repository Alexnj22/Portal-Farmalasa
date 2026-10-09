// Lo que llegó y NO venía en el pedido (los «extras»), y cómo se rotula una
// presentación de despacho — compartido por la recepción del portal
// (`RecepcionModal`) y la del teléfono.
//
// Un extra nace como un RENGLÓN del pedido con `error_tipo = 'sobrante'`
// (`agregar_extra_a_pedido`), así que la lista se siembra de lo que ya está
// anotado: reabrir la pantalla lo encuentra.

import { etiquetaDePresentacion } from './recepcionDePedido';

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
    }));
