// El CONTENIDO de la hoja de despacho de un pedido, sin pdfmake: qué renglones
// van, en qué presentación y con qué lotes, y las cajas especiales (E1, E2…).
//
// Vivía dentro de `pedidoPrint.printFromPedidoItems`, que además arma el PDF
// con pdfmake (sólo navegador). Sale acá para que el teléfono reimprima la
// MISMA hoja —mismos números, mismos lotes, mismas E— con su propio papel
// (`expo-print`). `pedidoPrint` reexporta lo que movió: sus importadores no
// cambian.
import { ERP_NAMES } from '../constants/erp';

export function toDispatch(qty, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return qty;
    return Math.round(qty * erpFactor / dispFactor);
}
export function lotesToDispatch(lotes, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return lotes ?? [];
    return (lotes ?? [])
        .map(l => ({ ...l, packs: Math.floor((l.packs ?? 0) * erpFactor / dispFactor) }))
        .filter(l => l.packs > 0);
}
export function lotesAsignadosToDispatch(lotes, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return lotes ?? [];
    return (lotes ?? [])
        .map(l => ({ ...l, take: toDispatch(l.take ?? l.cantidad ?? l.packs ?? 0, erpFactor, dispFactor) }))
        .filter(l => l.take > 0);
}

// Va a "Cajas Adicionales" solo si dispatch_label='CAJA' (Electrolit) o
// caja_especial. ESTUCHE/BOLSA van en tabla normal.
export function esAdicional(row) {
    return row.caja_especial === true
        || (row.tiene_dispatch_label === true && (row.dispatch_tipo ?? '').toUpperCase() === 'CAJA');
}

/**
 * La sección de UNA sala a partir de los renglones guardados del pedido
 * (`pedido_items` con `products`, `lotes_asignados`…). Los renglones normales
 * llevan `_rawId` para poder agruparlos por las hojas guardadas.
 *
 * `opciones.cantidad === 'enviada'` (2026-10-08): la REIMPRESIÓN de una sala ya
 * finalizada dice lo que SALIÓ (`cantidad_enviada`), no lo asignado — al
 * finalizar se puede despachar menos o nada de un renglón, y la hoja reimpresa
 * decía la cantidad vieja sobre una caja que llevaba otra. El renglón que no
 * salió se queda en la hoja con 0 en vez de desaparecer: las hojas se reparten
 * por renglones, y sacarlo corría a los de abajo a la hoja siguiente.
 */
export function seccionDePedido(sucId, rows, codigo = null, opciones = {}) {
    const porEnviado = opciones?.cantidad === 'enviada';
    const cantidadDe = r => (porEnviado ? (r.cantidad_enviada ?? r.cantidad_asignada) : r.cantidad_asignada) ?? 0;
    const printRows = rows.filter(r => !r.sin_stock && !esAdicional(r)).map(r => {
        const erpFactor  = r.factor ?? 1;
        const dispFactor = r.dispatch_factor ?? erpFactor;
        const dispTipo   = r.dispatch_tipo ?? r.presentaciones?.tipo ?? '';
        const qty        = toDispatch(cantidadDe(r), erpFactor, dispFactor);
        const isLabel    = r.tiene_dispatch_label === true;
        return {
            _rawId:            r.id,
            product_name:      r.products?.nombre ?? '?',
            laboratorio:       r.products?.laboratorios?.nombre ?? '',
            presentacion_tipo: dispTipo,
            es_antibiotico:    r.products?.es_antibiotico ?? false,
            qty,
            qty_base: isLabel ? qty * dispFactor : null,
            lotes: qty > 0 ? lotesAsignadosToDispatch(
                Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
                erpFactor, dispFactor,
            ) : [],
            _asignado: toDispatch(r.cantidad_asignada ?? 0, erpFactor, dispFactor),
        };
    }).filter(r => r.qty > 0 || (porEnviado && r._asignado > 0));

    let eCounter = 1;
    const especiales = rows
        .filter(r => !r.sin_stock && esAdicional(r) && cantidadDe(r) > 0)
        .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
        .flatMap(r => {
            const erpF     = r.factor ?? 1;
            const dispF    = r.dispatch_factor ?? erpF;
            const qty      = toDispatch(cantidadDe(r) || 1, erpF, dispF);
            const dispTipo = r.dispatch_tipo ?? r.presentaciones?.tipo ?? '';
            const rawLotes = lotesAsignadosToDispatch(
                Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
                erpF, dispF,
            ).filter(l => l.lote || l.fecha_vencimiento);
            const lotPool  = rawLotes.map(l => ({ ...l, _rem: l.take ?? l.cantidad ?? l.packs ?? 0 }));
            return Array.from({ length: qty }, () => {
                let boxLot = null;
                for (const lot of lotPool) {
                    if (lot._rem > 0) { boxLot = { lote: lot.lote, fecha_vencimiento: lot.fecha_vencimiento, take: 1 }; lot._rem--; break; }
                }
                return { label: `E${eCounter++}`, product_name: r.products?.nombre ?? '?', presentacion_tipo: dispTipo, dispF, tiene_dispatch_label: r.tiene_dispatch_label === true, lotes: boxLot ? [boxLot] : [] };
            });
        });

    return {
        sucId, nombre: ERP_NAMES[sucId] ?? `Sucursal ${sucId}`,
        codigo,
        rows:     printRows,
        especiales,
        sinCount: rows.filter(r => r.sin_stock).length,
        revCount: rows.filter(r => r.revision_minmax && !r.sin_stock && !r.caja_especial).length,
    };
}

/** El orden de la hoja: laboratorio, luego producto. */
export function ordenarRenglones(rows) {
    return [...rows].sort((a, b) =>
        (a.laboratorio || '').localeCompare(b.laboratorio || '', 'es')
        || (a.product_name || '').localeCompare(b.product_name || '', 'es'));
}

/**
 * Los renglones partidos en las HOJAS guardadas del pedido (`paginas`, las del
 * PDF exacto). Sin hojas guardadas, una sola. Lo que no aparece en ninguna hoja
 * guardada va al final, para que nada se pierda del papel.
 */
export function renglonesPorHoja(seccion, paginas = null) {
    const ordenados = ordenarRenglones(seccion.rows);
    if (!Array.isArray(paginas) || !paginas.length) return [ordenados];
    const porId = new Map(ordenados.map(r => [String(r._rawId), r]));
    const usados = new Set();
    const hojas = paginas.map(p => (p.ids ?? []).map(id => {
        const r = porId.get(String(id));
        if (r) usados.add(String(id));
        return r;
    }).filter(Boolean));
    const sueltos = ordenados.filter(r => !usados.has(String(r._rawId)));
    if (sueltos.length) hojas.push(sueltos);
    return hojas.filter(h => h.length);
}
