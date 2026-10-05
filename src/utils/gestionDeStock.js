/**
 * Gestión de stock — las dos preguntas sobre la existencia de una sala, dichas
 * una vez para el portal (`TabParados`, `TabSinMinMax`) y para la app.
 *
 *  · Productos sin venta: agrupados por ADÓNDE mandarlos, las salas primero (de
 *    la que más recibe a la que menos) y Bodega al final.
 *  · Vendidos sin Min/Max: qué hacer con cada uno (`sugerenciaMinMax`).
 *
 * Se mudaron el 2026-10-05 desde las dos pestañas.
 */

/** Un grupo por destino: `{ destino, filas, costo, unidades }`. */
export function gruposPorDestino(filas, bodega) {
    const m = new Map();
    for (const r of filas || []) {
        const d = Number(r.destino);
        if (!m.has(d)) m.set(d, []);
        m.get(d).push(r);
    }
    return [...m.entries()]
        .map(([destino, rows]) => ({
            destino,
            filas: rows,   // ya vienen de la base por costo, de mayor a menor
            costo: rows.reduce((s, r) => s + Number(r.costo || 0), 0),
            unidades: rows.reduce((s, r) => s + Number(r.existencia || 0), 0),
        }))
        .sort((a, b) => (a.destino === bodega) - (b.destino === bodega) || b.filas.length - a.filas.length);
}

/** Los totales de las tarjetas: los productos/unidades/costo son de lo VISIBLE; el resto, de todo. */
export function totalesDeParados(visibles, filas, bodega) {
    return {
        productos: visibles.length,
        unidades: visibles.reduce((s, r) => s + Number(r.existencia || 0), 0),
        costo: visibles.reduce((s, r) => s + Number(r.costo || 0), 0),
        conMinmax: filas.filter((r) => r.en_minmax).length,
        aSala: filas.filter((r) => Number(r.destino) !== bodega).length,
        aBodega: filas.filter((r) => Number(r.destino) === bodega).length,
    };
}

// units_sold está en unidades comerciales (cajas/bolsas), igual que el ERP.
// Los umbrales están calibrados para eso: 2 cajas/mes es demanda retail real.
// Umbral mayorista: ≥10 uds/factura promedio supera lo esperable en venta retail
// de farmacia — probablemente es un cliente que compra al por mayor.
export function sugerenciaMinMax(row) {
    const units     = Number(row.units_sold) || 0;
    const undMes    = units / 6;
    const revMes    = Number(row.revenue) / 6;
    // La ventana de seis meses toca SIETE meses de calendario (del 24-mar al
    // 24-sep son mar…sep), así que la función puede contar 7. Se tope en 6:
    // «7 de 6 meses» salió en pantalla el 2026-09-24.
    const months    = Math.min(6, Number(row.months_with_sales) || 0);
    const invoices  = Number(row.invoice_count) || 1;
    const avgPerInv = units / invoices;

    if (avgPerInv >= 10) {
        return { level: 'mayorista', label: 'Venta mayorista',
            reason: `${avgPerInv.toFixed(1)} uds. por factura · no agregar`, months, invoices, avgPerInv };
    }
    if (invoices <= 3 && avgPerInv > 4) {
        return { level: 'encargo', label: 'Posible encargo',
            reason: `${invoices} factura${invoices !== 1 ? 's' : ''} · no agregar`, months, invoices, avgPerInv };
    }
    const consistent   = months >= 6;
    const highRotation = revMes >= 15 && undMes >= 2;
    const highVolume   = undMes >= 5;
    const moderate     = revMes >= 5 || undMes >= 1 || months >= 4;

    if (highRotation || highVolume || consistent) {
        const minSug = Math.max(1, Math.round(undMes));
        const maxSug = Math.max(2, Math.round(undMes * 2));
        const reason = consistent && !highRotation && !highVolume ? 'Se vende todos los meses'
            : highVolume && !highRotation ? 'Alto volumen' : 'Buena rotación';
        return { level: 'agregar', label: `Min ${minSug} · Max ${maxSug}`, reason, minSug, maxSug, months, invoices, avgPerInv };
    }
    if (moderate) {
        return { level: 'evaluar', label: 'Evaluar',
            reason: months >= 4 ? `${months} de 6 meses con venta` : 'Rotación moderada', months, invoices, avgPerInv };
    }
    return { level: 'omitir', label: 'Sin acción', reason: 'Rotación insuficiente', months, invoices, avgPerInv };
}

export const FILTROS_MINMAX = [
    { value: 'agregar',   label: 'Agregar Min/Max' },
    { value: 'evaluar',   label: 'Evaluar' },
    { value: 'encargo',   label: 'Posible encargo' },
    { value: 'mayorista', label: 'Mayorista' },
    { value: 'omitir',    label: 'Sin acción' },
    { value: 'ignorado',  label: 'Descartados' },
];

/** Cuántos hay en cada filtro; los descartados no cuentan en su nivel. */
export function conteosMinMax(filas, ignorados) {
    const c = { agregar: 0, evaluar: 0, encargo: 0, mayorista: 0, omitir: 0, ignorado: 0 };
    for (const r of filas || []) {
        if (ignorados.has(r.erp_product_id)) c.ignorado++;
        else c[sugerenciaMinMax(r).level]++;
    }
    return c;
}

/** El Min/Max que se pide: enteros, Max mayor que cero y Min que no lo pase. `null` = válido. */
export function problemaDeMinMax(min, max) {
    const a = Number(min), b = Number(max);
    if (String(min).trim() === '' || String(max).trim() === '' || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b <= 0 || a > b) {
        return 'El Min tiene que ser un número entero y no puede pasar al Max.';
    }
    return null;
}

/** El motivo que acompaña la solicitud, para quien la aprueba. */
export function motivoDeMinMax(row) {
    const s = sugerenciaMinMax(row);
    return `Se vende sin Min/Max (Gestión de stock): ${s.reason.toLowerCase()}, `
        + `${Number(row.units_sold) || 0} unidades en 6 meses en ${s.months} de 6 meses.`;
}
