/**
 * La aritmética de una cotización: el precio viene CON IVA (13%), y a un
 * gran contribuyente que retiene se le resta el 1% sobre la base. Vivía en
 * `CotizacionesView` y estaba escrita DOS veces —en la pantalla y en el papel
 * que se imprime—; se mudó el 2026-10-05 a una sola, la misma que usa la app.
 */
export const IVA_COTIZACION = 0.13;
export const RETENCION_COTIZACION = 0.01;
export const UMBRAL_RETENCION = 100;

/** Un precio con IVA, separado en base e impuesto, por unidad y por la cantidad. */
export function desgloseConIva(precioConIva, cantidad = 1) {
    const unitSinIva = precioConIva / (1 + IVA_COTIZACION);
    const unitIva = precioConIva - unitSinIva;
    return {
        unitSinIva, unitIva,
        subtotalSinIva: unitSinIva * cantidad,
        subtotalIva: unitIva * cantidad,
        total: precioConIva * cantidad,
    };
}

/** Los totales: bruto (con IVA), base, IVA, retención (si aplica) y total. */
export function totalesDeCotizacion(items, aplicaRetencion) {
    const gross = (items || []).reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0);
    const base = gross / (1 + IVA_COTIZACION);
    const iva = gross - base;
    const retention = aplicaRetencion ? base * RETENCION_COTIZACION : 0;
    return { gross, base, iva, retention, total: gross - retention };
}

// ── El formulario de una cotización (portal y app) ──────────────────────────
// Vivía dentro de `CotizacionesView`. La app arma la misma cotización y tiene
// que guardar exactamente las mismas filas: los niveles de precio, cómo cambia
// un renglón al elegir otra presentación o nivel, y qué se manda a la base.

/** Los niveles de precio, en su orden canónico (el del control de acceso). */
export const COLUMNAS_DE_PRECIO = [
    { key: 'vineta', label: 'Viñeta' },
    { key: 'descuento_1', label: 'Descuento 1' },
    { key: 'vip', label: 'VIP' },
    { key: 'clinica', label: 'Clínica' },
    { key: 'mayoreo', label: 'Mayoreo' },
    { key: 'premium', label: 'Premium' },
    { key: 'precio_7', label: 'Precio 7' },
];
export const ORDEN_DE_NIVELES = COLUMNAS_DE_PRECIO.map(c => c.key);

export const FORMAS_DE_PAGO_COTIZACION = [
    { value: 'EFECTIVO', label: 'Efectivo' },
    { value: 'TARJETA', label: 'Tarjeta' },
    { value: 'TRANSFERENCIA', label: 'Transferencia' },
    { value: 'CHEQUE', label: 'Cheque' },
];
export const TIPOS_DE_DOCUMENTO_COTIZACION = [
    { value: 'COF', label: 'COF' },
    { value: 'CCF', label: 'CCF' },
];

/** Los niveles que el cargo puede ofrecer: hasta su `maxPriceLevel`, todos si no tiene. */
export function nivelesPermitidos(maxPriceLevel) {
    if (!maxPriceLevel) return COLUMNAS_DE_PRECIO;
    const tope = ORDEN_DE_NIVELES.indexOf(maxPriceLevel);
    if (tope === -1) return COLUMNAS_DE_PRECIO;
    return COLUMNAS_DE_PRECIO.filter(c => ORDEN_DE_NIVELES.indexOf(c.key) <= tope);
}

const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');

/** Las presentaciones con sus precios, por producto: `{ [productId]: [pres…] }`. */
export function mapaDePreciosDeCotizacion(filas) {
    const mapa = {};
    (filas || []).forEach((p) => {
        const pid = String(p.product_id);
        if (!mapa[pid]) mapa[pid] = [];
        const tipoLabel = capitalizar(p.presentaciones?.tipo || '') || `Pres. ${p.id_presentacion}`;
        const subdesc = p.descripcion || '';
        mapa[pid].push({
            presentacion_id: p.id_presentacion, tipoLabel, subdesc,
            desc: subdesc ? `${tipoLabel} (${subdesc})` : tipoLabel,
            vineta: p.vineta, descuento_1: p.descuento_1, vip: p.vip, clinica: p.clinica,
            mayoreo: p.mayoreo, premium: p.premium, precio_7: p.precio_7,
        });
    });
    return mapa;
}

/** Un renglón nuevo: la primera presentación a precio de viñeta, cantidad 1. */
export function renglonNuevo(producto, presentaciones) {
    const primera = (presentaciones || [])[0];
    const precio = primera ? parseFloat(primera.vineta || 0) : 0;
    return {
        _id: Date.now() + Math.random(),
        productId: String(producto.id),
        productName: producto.nombre,
        presentacionId: primera ? String(primera.presentacion_id) : '',
        presentacionDesc: primera?.desc || '',
        priceType: 'vineta',
        cantidad: 1,
        precioUnitario: precio,
        subtotal: precio,
    };
}

/** El renglón con un campo cambiado: recalcula precio y subtotal como el portal. */
export function actualizarRenglon(item, campo, valor, presentaciones) {
    const u = { ...item, [campo]: valor };
    const lista = presentaciones || [];
    if (campo === 'presentacionId') {
        const pres = lista.find(p => String(p.presentacion_id) === String(valor));
        u.presentacionDesc = pres?.desc || '';
        u.precioUnitario = parseFloat(pres?.[u.priceType] || 0);
        u.subtotal = u.precioUnitario * u.cantidad;
    }
    if (campo === 'priceType') {
        const pres = lista.find(p => String(p.presentacion_id) === String(item.presentacionId));
        u.precioUnitario = parseFloat(pres?.[valor] || 0);
        u.subtotal = u.precioUnitario * u.cantidad;
    }
    if (campo === 'cantidad') {
        u.cantidad = Math.max(0, parseFloat(valor) || 0);
        u.subtotal = u.cantidad * u.precioUnitario;
    }
    if (campo === 'precioUnitario') {
        u.precioUnitario = Math.max(0, parseFloat(valor) || 0);
        u.subtotal = u.precioUnitario * u.cantidad;
    }
    return u;
}

/** Las filas de `cotizacion_items` que se guardan (sin `cotizacion_id`). */
export function renglonesParaGuardar(items) {
    return (items || []).map((it, idx) => ({
        product_id: parseInt(it.productId),
        product_nombre: it.productName,
        presentacion_id: it.presentacionId ? parseInt(it.presentacionId) : null,
        presentacion_desc: it.presentacionDesc || null,
        price_type: it.priceType,
        cantidad: it.cantidad,
        precio_unitario: it.precioUnitario,
        subtotal: it.subtotal,
        sort_order: idx,
    }));
}

/** Un renglón guardado, de vuelta a la forma del formulario (para editar). */
export function renglonDesdeGuardado(it) {
    return {
        _id: Date.now() + Math.random() + it.id,
        productId: String(it.product_id),
        productName: it.product_nombre,
        presentacionId: it.presentacion_id ? String(it.presentacion_id) : '',
        presentacionDesc: it.presentacion_desc || '',
        priceType: it.price_type || 'vineta',
        cantidad: parseFloat(it.cantidad),
        precioUnitario: parseFloat(it.precio_unitario),
        subtotal: parseFloat(it.subtotal),
    };
}

/** La fila de la cotización. `cliente` es `{ id, name, nit }` o null (consumidor final). */
export function payloadDeCotizacion({ fecha, cliente, docType, paymentType, appliesRetention, notes, items, branchId, user }) {
    const t = totalesDeCotizacion(items, appliesRetention);
    return {
        fecha,
        customer_id: cliente?.id || null,
        customer_name: cliente?.name || 'Consumidor Final',
        customer_nit: cliente?.nit || null,
        document_type: docType,
        payment_type: paymentType,
        applies_retention: appliesRetention,
        subtotal_gravado: t.base,
        iva_amount: t.iva,
        retention_amount: t.retention,
        total: t.total,
        notes: notes || null,
        branch_id: branchId ? parseInt(branchId) : (user?.branchId || null),
        created_by: user?.id || null,
        created_by_name: user?.name || null,
        created_by_photo: user?.photo || null,
    };
}
