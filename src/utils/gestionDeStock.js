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
import { paraBodega } from './unidadDeDespacho';
import { lotesEnUnidades, repartirPedido, sumaUnidades } from './unidadesInventario';
import { porQueDesde } from './productosParados';
import { fechaTexto } from './fecha';

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
        .sort((a, b) => Number(a.destino === bodega) - Number(b.destino === bodega) || b.filas.length - a.filas.length);
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

// ── El envío sugerido de «Sin venta» (2026-10-15) ───────────────────────────
// Lo que arma el botón «Armar envío» de cada grupo y lo que el formulario de
// envío hace con eso al abrirse. Vivía dentro de `TabParados` y de
// `EnviarProductoModal`; se mudó para que la app arme el MISMO envío.

/** Lo que admite un envío (`TOPE_RENGLONES_ENVIO`): lo que sobra va en el siguiente. */
export const POR_ENVIO = 20;

/** A Bodega sólo vuelve lo que completa su unidad de despacho (usuario, 24-sep). */
export function devolviblesABodega(filas, despacho) {
    return (filas || [])
        .map((r) => ({ r, b: paraBodega(r.existencia, despacho?.get(Number(r.erp_product_id))) }))
        .filter((x) => x.b.completos > 0);
}

/** Cuántos productos de un grupo se pueden mandar (a Bodega, sólo los devolvibles). */
export function cuantosArmables(grupo, despacho, bodega) {
    return grupo.destino === bodega ? devolviblesABodega(grupo.filas, despacho).length : grupo.filas.length;
}

/**
 * Los productos que precargan el envío de un grupo. A Bodega, en la
 * presentación de despacho y sólo lo completo; a otra sala, todo, en la
 * presentación más chica (sin `presentacion`).
 */
export function productosDeEnvioSugerido(grupo, despacho, bodega, porEnvio = POR_ENVIO) {
    if (grupo.destino === bodega) {
        return devolviblesABodega(grupo.filas, despacho).slice(0, porEnvio).map(({ r, b }) => {
            const u = despacho.get(Number(r.erp_product_id));
            // Si se despacha de a 1 no hay regla que cumplir: va todo, en la
            // presentación más chica. El «UNIDAD» de la base es un rótulo, no
            // el nombre de una presentación real (CARBIMEN no la tiene).
            return Number(u?.unidades) > 1
                ? { erp_product_id: r.erp_product_id, descripcion: r.producto,
                    presentacion: { tipo: u.tipo, factor: u.factor, cantidad: b.cantidad } }
                : { erp_product_id: r.erp_product_id, descripcion: r.producto };
        });
    }
    return grupo.filas.slice(0, porEnvio).map((r) => ({ erp_product_id: r.erp_product_id, descripcion: r.producto }));
}

/** El «por qué» del envío sugerido: obligatorio, el mismo para todos, editable. */
export function notaDeEnvioSugerido(destino, bodega, nombreSala, nombreDestino) {
    return Number(destino) === Number(bodega)
        ? `Seis meses sin venderse en ${nombreSala}, y ninguna sala vendió 3 o más.`
        : `Seis meses sin venderse en ${nombreSala}; en ${nombreDestino} sí se vende.`;
}

/**
 * Los renglones del envío sugerido, a partir de la existencia de la sala
 * (`fetchExistenciasDeProductos`) y las presentaciones (`fetchPresentaciones`,
 * de la más chica a la más grande). Cada producto sale con TODO lo que hay en
 * su presentación más chica —o en la pedida, con su tope—, y los lotes se
 * reparten con `repartirPedido`. Lo que no se puede armar vuelve en `fuera`,
 * con su motivo: un renglón que desaparece sin aviso se lee como «ya lo mandé».
 *
 * Devuelve `{ listos, fuera }`; cada renglón lleva `erp_product_id`,
 * `descripcion`, `presentacion_tipo`, `factor`, `cantidad`, `unidades`,
 * `lotes` ({ lote, vence, unidades }), `existencia` y `presentaciones`.
 */
export function renglonesDeEnvioSugerido(productos, filasExistencia, presPorProducto) {
    const porProducto = new Map();
    for (const f of filasExistencia || []) {
        const id = Number(f.erp_product_id);
        if (!porProducto.has(id)) porProducto.set(id, []);
        porProducto.get(id).push(f);
    }
    const listos = [];
    const fuera = [];
    for (const p of productos || []) {
        const id = Number(p.erp_product_id);
        const fs = porProducto.get(id) ?? [];
        const total = sumaUnidades(fs);
        const lista = presPorProducto?.get(id) ?? [];
        const pedida = p.presentacion
            ? lista.find((x) => x.tipo === p.presentacion.tipo && Number(x.factor) === Number(p.presentacion.factor))
            : null;
        const pr = p.presentacion ? pedida : lista[0];
        const cant = !pr ? 0
            : p.presentacion ? Math.min(Number(p.presentacion.cantidad) || 0, Math.floor(total / Number(pr.factor)))
                : Math.floor(total / Number(pr.factor));
        if (!total || !pr || cant <= 0) {
            fuera.push({ descripcion: p.descripcion, motivo: !total ? 'ya no hay existencia'
                : p.presentacion && !pedida ? `no tiene la presentación ${p.presentacion.tipo}` : 'no tiene presentación' });
            continue;
        }
        const unidades = cant * Number(pr.factor);
        const rep = repartirPedido(lotesEnUnidades(fs), unidades);
        listos.push({
            erp_product_id: id,
            descripcion: fs[0]?.descripcion ?? p.descripcion,
            presentacion_tipo: pr.tipo,
            factor: Number(pr.factor),
            cantidad: cant,
            unidades,
            lotes: rep.reparto.map((l) => ({ lote: l.lote, vence: l.vence, unidades: l.toma })),
            existencia: total,
            presentaciones: lista,
        });
    }
    return { listos, fuera };
}

// ── Las descargas (2026-10-15) ──────────────────────────────────────────────
// Encabezados y filas del CSV de cada pestaña, dichos una vez para el portal y
// la app. El nombre del archivo lleva la sala; el módulo es `inventario_sin_venta`.

const archivoDe = (prefijo, suc, hoy) => `${prefijo}_${String(suc).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${hoy}.csv`;

/** CSV de «Sin venta»: `{ headers, rows, nombre }`. `nombres` = id de sala → nombre. */
export function csvDeParados(grupos, sala, nombres, hoy) {
    const suc = nombres[sala] || `Suc.${sala}`;
    const dia = (f) => (f ? fechaTexto(f, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
    const headers = ['Sucursal', 'Enviar a', 'Producto', 'Laboratorio', 'Unidades', 'Costo',
        'Cuenta desde', 'Por qué esa fecha', 'Días', 'Vendidas allá (6m)', 'Min', 'Max'];
    const rows = (grupos || []).flatMap((g) => g.filas.map((r) => [
        suc, nombres[g.destino] || '', r.producto || '', r.laboratorio || '',
        Number(r.existencia) || 0, (Number(r.costo) || 0).toFixed(2),
        dia(r.desde), porQueDesde(r), r.dias ?? '',
        r.destino_unidades != null ? Number(r.destino_unidades) : '',
        r.en_minmax && r.min_qty != null ? Number(r.min_qty) : '',
        r.en_minmax && r.max_qty != null ? Number(r.max_qty) : '',
    ]));
    return { headers, rows, nombre: archivoDe('productos_parados', suc, hoy) };
}

/** CSV de «Sin Min/Max» (lo filtrado): `{ headers, rows, nombre }`. */
export function csvSinMinMax(filtradas, ignorados, sala, nombres, hoy) {
    const suc = nombres[sala] || `Suc.${sala}`;
    const headers = ['Sucursal', 'Producto', 'Laboratorio', 'Meses con venta', 'Unidades (6m)', 'Unidades/mes',
        'Venta (6m)', 'Venta/mes', 'Facturas', 'Unidades/factura', 'Qué hacer', 'Motivo', 'Min sugerido', 'Max sugerido'];
    const rows = (filtradas || []).map((r) => {
        const s = sugerenciaMinMax(r);
        const ign = ignorados.has(r.erp_product_id);
        const units = Number(r.units_sold) || 0, rev = Number(r.revenue) || 0;
        return [suc, r.product_name || '', r.laboratorio || '', `${s.months}/6`, units, (units / 6).toFixed(1),
            rev.toFixed(2), (rev / 6).toFixed(2), s.invoices, s.avgPerInv.toFixed(1),
            ign ? 'Descartado' : FILTROS_MINMAX.find((f) => f.value === s.level)?.label, ign ? 'Descartado a mano' : s.reason,
            s.minSug ?? '', s.maxSug ?? ''];
    });
    return { headers, rows, nombre: archivoDe('sin_minmax', suc, hoy) };
}

/** El orden de «Sin Min/Max»: por nombre (alfabético) o por un número. */
export function ordenarSinMinMax(filas, campo = 'revenue', dir = 'desc') {
    return [...(filas || [])].sort((a, b) => {
        if (campo === 'product_name') {
            const cmp = (a.product_name || '').localeCompare(b.product_name || '', 'es');
            return dir === 'asc' ? cmp : -cmp;
        }
        const av = Number(a[campo] || 0), bv = Number(b[campo] || 0);
        return dir === 'asc' ? av - bv : bv - av;
    });
}
