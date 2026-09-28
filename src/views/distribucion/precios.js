// Precios de la venta en ruta: presentación × lista de precio.
//
// Es el GEMELO de pantalla de la decisión que toma el trigger
// `dist_validar_item` (borrador 0004) — la pantalla muestra, la base decide:
//   1. la lista pedida para ese renglón (o la del encabezado de la venta);
//   2. si esa presentación no tiene precio en esa lista, la lista BASE (la de
//      menor `orden`);
//   3. si el producto no tiene precios por presentación, «UNIDAD» con el
//      precio del catálogo.
// Si las dos reglas divergieran, la pantalla mostraría un total y el
// documento saldría con otro: al cambiar una, cambiar la otra.
//
// Los precios son CON IVA, en centavos (borrador 0007). Las cuentas —IVA,
// descuento, total— no se hacen acá: las hace `motor.js`, que es el mismo
// motor del documento.

export const UNIDAD = 'UNIDAD';

/** Indexa los precios por producto → presentación → lista. */
export function indexarPrecios(precios, listas) {
    const activas = (listas ?? []).filter(l => l.activo !== false).sort((a, b) => a.orden - b.orden || a.id - b.id);
    const ordenDe = new Map(activas.map((l, i) => [l.id, i]));
    const porProducto = new Map();
    for (const p of precios ?? []) {
        if (!ordenDe.has(p.lista_id)) continue; // lista desactivada: la base tampoco la usa
        let pres = porProducto.get(p.product_id);
        if (!pres) porProducto.set(p.product_id, (pres = new Map()));
        let e = pres.get(p.presentacion);
        if (!e) pres.set(p.presentacion, (e = { presentacion: p.presentacion, unidades: p.unidades, porLista: new Map() }));
        e.porLista.set(p.lista_id, Number(p.precio_con_iva));
    }
    return { porProducto, listas: activas, ordenDe };
}

/** Las presentaciones que se le pueden vender de un producto, de la menor a la mayor. */
export function presentacionesDe(idx, productId) {
    const pres = idx.porProducto.get(Number(productId));
    if (!pres?.size) return [{ presentacion: UNIDAD, unidades: 1 }];
    return [...pres.values()]
        .map(({ presentacion, unidades }) => ({ presentacion, unidades }))
        .sort((a, b) => a.unidades - b.unidades || a.presentacion.localeCompare(b.presentacion));
}

/** Las listas en que esa presentación tiene precio. */
export function listasDe(idx, productId, presentacion) {
    const e = idx.porProducto.get(Number(productId))?.get(presentacion);
    if (!e) return [];
    return idx.listas.filter(l => e.porLista.has(l.id));
}

/**
 * El precio CON IVA de un renglón, con la lista que de verdad se aplicó.
 * `null` si esa presentación no existe para el producto (la base lo rechaza).
 */
export function precioDe(idx, producto, presentacion, listaId) {
    const e = idx.porProducto.get(Number(producto.product_id))?.get(presentacion);
    if (!e) {
        if (presentacion !== UNIDAD) return null;
        return { precio: Number(producto.precio_con_iva), listaId: null, unidades: 1 };
    }
    const pedida = listaId != null && e.porLista.has(Number(listaId)) ? Number(listaId) : null;
    const usada = pedida ?? idx.listas.find(l => e.porLista.has(l.id))?.id ?? null;
    if (usada == null) return null;
    return { precio: e.porLista.get(usada), listaId: usada, unidades: e.unidades };
}
