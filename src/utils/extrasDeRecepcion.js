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

/**
 * Las presentaciones activas de un producto, una por factor, con su rótulo.
 *
 * `label` es para la PANTALLA («UNIDAD 1x1» = tipo + descripción); `tipo` es el
 * nombre con el que la presentación vive en el sistema («UNIDAD»), y es el
 * único que se escribe. Mover el sobrante busca la presentación por ese nombre:
 * guardando el rótulo, el LUBRIDERM de Bodega falló con «llegó como UNIDAD 1x1
 * de 1, y hoy ninguna presentación con ese nombre trae ese factor» (2026-10-21).
 */
export function opcionesDelCatalogo(precios = []) {
    const opts = [];
    for (const p of precios) {
        const f = Number(p.factor) || 1;
        if (!opts.find(x => x.factor === f)) opts.push({ factor: f, label: etiquetaDePresentacion(p), tipo: p.presentaciones?.tipo || null });
    }
    return opts;
}

/** El nombre de sistema de la presentación elegida — lo que se escribe, nunca el rótulo. */
export const tipoDeOpcion = (opciones = [], factor) =>
    (opciones ?? []).find(o => o.factor === factor)?.tipo ?? null;

/**
 * Las opciones de un extra, con la del último despacho primero SI EXISTE en el
 * catálogo. El paquete de despacho («BOLSA ×20») es la comodidad de Bodega para
 * armar cajas, no una presentación del sistema: ponerlo de opción —y encima de
 * default— guardaba un factor que mover el sobrante no encuentra. Sólo entra
 * cuando el catálogo no trae nada, que es mejor que dejar el extra sin opción.
 */
export function opcionesDeExtra(opciones = [], ultimoDespacho = null) {
    const out = [...opciones];
    if (ultimoDespacho) {
        const df = Number(ultimoDespacho.dispatch_factor) || 1;
        const i = out.findIndex(o => o.factor === df);
        if (i > 0) out.unshift(...out.splice(i, 1));
        else if (i < 0 && out.length === 0) out.push({ factor: df, label: rotuloDeDespacho(ultimoDespacho.dispatch_tipo, df), tipo: ultimoDespacho.dispatch_tipo || null });
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
    // Sólo presentaciones que son un número ENTERO de la del sistema. Lo
    // contado se guarda en la presentación del sistema, así que 25 unidades de
    // algo que el sistema lleva en cajas de 10 se redondeaban a 3 cajas —un
    // sobrante de 5 que nadie contó— y 4 unidades a 0 (2026-10-21).
    const cabe = (f) => Number(f) > 0 && Number(f) % erpFactor === 0;
    const vistos = new Set();
    const opts = [];
    if (r.dispatch_tipo && dispFactor !== erpFactor && cabe(dispFactor)) { opts.push(dispOpt); vistos.add(dispFactor); }
    (presMap?.[r.erp_product_id] ?? []).forEach((o) => {
        if (!vistos.has(o.factor) && cabe(o.factor)) { opts.push(o); vistos.add(o.factor); }
    });
    if (!opts.length && cabe(dispFactor) && dispFactor !== erpFactor) { opts.push(dispOpt); vistos.add(dispFactor); }
    // La del sistema va siempre: es la que nunca redondea. Su rótulo sale de
    // la fila (`presentaciones.tipo`), no de «Unidad ×N», que la hacía pasar
    // por unidades sueltas y empujaba a contar unidades donde se piden cajas.
    const tipoSistema = r.presentaciones?.tipo;
    [erpFactor, conteoInicial(r).fPres, ...incluir].forEach((f) => {
        if (!vistos.has(f) && cabe(f)) {
            const label = f === erpFactor && tipoSistema ? tipoSistema : rotuloDeDespacho('UNIDAD', f);
            opts.push({ factor: f, label, tipo: f === erpFactor ? (tipoSistema || null) : null });
            vistos.add(f);
        }
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
