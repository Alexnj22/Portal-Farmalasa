/**
 * Los niveles de precio de un producto y cuáles puede ver cada cargo. Vivían
 * escritos dentro de `views/productos/TabCatalogo.jsx` —el filtro, dos veces—;
 * se mudaron el 2026-10-02 para que la app del teléfono muestre exactamente
 * los mismos niveles al mismo cargo.
 */

/** Los siete niveles, en orden de menor a mayor descuento. */
export const NIVELES_DE_PRECIO = [
    { key: 'vineta', label: 'Víneta' },
    { key: 'descuento_1', label: 'Desc. 1' },
    { key: 'vip', label: 'VIP' },
    { key: 'clinica', label: 'Clínica' },
    { key: 'mayoreo', label: 'Mayoreo' },
    { key: 'premium', label: 'Premium' },
    { key: 'precio_7', label: 'Precio 7' },
];
export const ORDEN_DE_NIVELES = NIVELES_DE_PRECIO.map((n) => n.key);
/** Las columnas de precio, para un `select`. */
export const COLUMNAS_DE_PRECIO = ORDEN_DE_NIVELES.join(', ');

/**
 * Los niveles que ve un cargo: hasta su `maxPriceLevel`, incluido. Sin tope
 * —o con un tope que no es un nivel— ve todos, igual que siempre en el portal.
 */
export function nivelesVisibles(maxPriceLevel) {
    if (!maxPriceLevel) return NIVELES_DE_PRECIO;
    const tope = ORDEN_DE_NIVELES.indexOf(maxPriceLevel);
    if (tope === -1) return NIVELES_DE_PRECIO;
    return NIVELES_DE_PRECIO.filter((n) => ORDEN_DE_NIVELES.indexOf(n.key) <= tope);
}

// ── Márgenes ────────────────────────────────────────────────────────────────
// Vivían en `views/productos/TabCatalogo.jsx`; se mudaron el 2026-10-06 para
// que la ficha del teléfono avise «pérdida» y «margen bajo» con la MISMA regla.

/** Los niveles que entran a la alerta de margen: Premium y Precio 7 son
 *  precios especiales/externos y no cuentan (Premium tiene su propio aviso). */
export const NIVELES_DE_MARGEN = NIVELES_DE_PRECIO.filter((f) => f.key !== 'precio_7' && f.key !== 'premium');
const NIVELES_DE_PERDIDA_ESPECIAL = NIVELES_DE_PRECIO.filter((f) => f.key === 'premium');

/** El margen de un precio sobre su costo, en %, o `null` si falta alguno. */
export function calcMargin(price, costo) {
    const p = parseFloat(price), c = parseFloat(costo);
    if (!p || !c || p <= 0 || c <= 0) return null;
    return (p - c) / p * 100;
}

/** `{ nivel: margen% }` de una presentación (`pp.costo` + los niveles). */
export function allMargins(pp, fields = NIVELES_DE_PRECIO) {
    const costo = parseFloat(pp.costo);
    if (!costo || costo <= 0) return {};
    const out = {};
    fields.forEach((f) => {
        const price = parseFloat(pp[f.key]);
        if (price > 0) out[f.key] = (price - costo) / price * 100;
    });
    return out;
}

/** El peor margen de una presentación entre `fields`, o `null`. */
export function worstMarginOf(pp, fields = NIVELES_DE_PRECIO) {
    const vals = Object.values(allMargins(pp, fields));
    return vals.length ? Math.min(...vals) : null;
}

/** Los precios especiales (Premium) por debajo del costo en una presentación. */
export function specialLossKeys(pp) {
    const costo = parseFloat(pp.costo);
    if (!costo || costo <= 0) return [];
    return NIVELES_DE_PERDIDA_ESPECIAL
        .filter((f) => { const p = parseFloat(pp[f.key]); return p > 0 && p < costo; })
        .map((f) => f.key);
}

export const specialLossLabel = (key) => (key === 'premium' ? 'Premium' : 'Precio 7');

/** El rótulo de un margen: pérdida (<0), margen bajo (<15 %) o nada. */
export function marginLabel(m) {
    if (m === null || m === undefined) return null;
    if (m < 0) return { label: 'Pérdida', variante: 'danger' };
    if (m < 15) return { label: 'Margen bajo', variante: 'warning' };
    return null;
}

/**
 * La alerta de margen de un producto entero: el peor margen entre sus
 * presentaciones (sólo los niveles que el cargo ve y que cuentan) y los
 * precios especiales en pérdida.
 */
export function alertaDeMargen(precios, nivelesQueVe = NIVELES_DE_PRECIO) {
    const campos = nivelesQueVe.filter((f) => f.key !== 'precio_7' && f.key !== 'premium');
    const peor = (precios || []).reduce((min, pp) => {
        const w = worstMarginOf(pp, campos);
        if (w === null) return min;
        return min === null ? w : Math.min(min, w);
    }, null);
    const especiales = new Set();
    (precios || []).forEach((pp) => specialLossKeys(pp).forEach((k) => especiales.add(k)));
    return { peor, especiales: [...especiales] };
}

// ── Historiales de la ficha ─────────────────────────────────────────────────

/**
 * Cómo se compra un producto, mirando su historial: «Nuevo» (la primera compra
 * es de los últimos 60 días), «Reentrada» (volvió después de más de 60 días
 * sin compras intermedias), «Regular» o `null`. `hoy` se puede fijar para probar.
 */
export function clasificarCompras(purchases, hoy = new Date()) {
    if (!purchases || purchases.length === 0) return null;
    const cut60 = new Date(hoy); cut60.setDate(hoy.getDate() - 60);
    const cut270 = new Date(hoy); cut270.setDate(hoy.getDate() - 270);
    const dates = purchases
        .map((p) => new Date(p.purchase_receipts?.fecha))
        .filter((d) => !isNaN(d.getTime()))
        .sort((a, b) => a - b);
    if (dates.length === 0) return null;
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    if (firstDate >= cut60) return 'Nuevo';
    const hasRecent = lastDate >= cut60;
    const hasIntermediate = dates.some((d) => d < cut60 && d >= cut270);
    if (hasRecent && !hasIntermediate) return 'Reentrada';
    if (hasRecent) return 'Regular';
    return null;
}

/** Las compras con recibo, de la más nueva a la más vieja. */
export const comprasOrdenadas = (purchases) => [...(purchases || [])]
    .filter((p) => p.purchase_receipts)
    .sort((a, b) => new Date(b.purchase_receipts.fecha) - new Date(a.purchase_receipts.fecha));

/**
 * El historial de precios sin repetidos: `product_precios_history` guarda una
 * fila por corrida del sync aunque el precio no cambie, así que se colapsan los
 * snapshots consecutivos idénticos por presentación. Más nuevo primero.
 */
export function historialDePreciosSinRepetir(history) {
    const out = [];
    const lastByPres = {};
    for (const r of (history || [])) {
        const key = r.id_presentacion;
        const snap = JSON.stringify(ORDEN_DE_NIVELES.map((k) => r[k]));
        if (lastByPres[key] !== snap) { out.push(r); lastByPres[key] = snap; }
    }
    return out.sort((a, b) => new Date(b.valid_from) - new Date(a.valid_from));
}
