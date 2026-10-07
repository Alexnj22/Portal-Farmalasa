// Movido desde src/views/distribucion/compras.js (2026-10-07): lo usan el portal y la app.
// Los íconos de VISTAS_COMPRAS se quedan en la pantalla del portal.
import { hoySV } from './fecha';
import { formatMoney } from './formatNumber';

// Las cuentas de una compra a proveedor, escritas UNA vez: las usa el
// formulario para avisar mientras se captura, y son las mismas que exige
// `dist_recibir_compra` (borrador 0015) antes de mover inventario. Si una
// cambia, cambia la otra: el aviso en pantalla que dice «cuadra» y el servidor
// que dice «no cuadra» es peor que no avisar.
//
// Y el lector del documento electrónico del proveedor: con el JSON que manda
// Hacienda la compra se llena sola —número, fecha, montos y renglones— y sus
// códigos se traducen a productos del catálogo con lo que se recordó la vez
// anterior.

export const IVA = 0.13;

export const TIPOS_COMPRA = [
    { value: '03', label: 'Crédito Fiscal' },
    { value: '01', label: 'Factura' },
    { value: '14', label: 'Sujeto excluido' },
];

export const VISTAS_COMPRAS = [
    { key: 'recibida', label: 'Recibidas' },
    { key: 'borrador', label: 'Borradores' },
    { key: 'anulada', label: 'Anuladas' },
];

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const num = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

/** Lo que vale un renglón en el documento: unidades × costo, redondeado como lo redondea el proveedor. */
export function subtotalRenglon(it) {
    return r2(num(it.cantidad) * num(it.costo_unitario));
}

/**
 * Lo que DEBERÍA decir el documento según los renglones. En un Crédito Fiscal
 * el IVA va aparte (13 % de lo gravado); en una Factura el precio ya lo trae y
 * no se acredita, así que el costo es el precio completo.
 */
export function totalesCalculados(items, tipoDoc) {
    const productos = r2((items ?? []).reduce((a, it) => a + subtotalRenglon(it), 0));
    const iva = tipoDoc === '03' ? r2(productos * IVA) : 0;
    return { productos, iva };
}

/** El total que tiene que dar el documento con sus propios montos. */
export function totalEsperado(c) {
    return r2(num(c.gravada) + num(c.exenta) + num(c.iva) + num(c.percepcion) - num(c.retencion));
}

/** Un centavo por renglón, mínimo dos: la misma tolerancia que la base. */
export const toleranciaDeCuadre = (renglones) => Math.max(0.02, 0.01 * renglones);

/**
 * Todo lo que impide RECIBIR la compra, en el orden en que conviene
 * arreglarlo. `campo` dice dónde pintarlo. Vacío = se puede recibir.
 */
export function problemasDeCompra(c, { hoy = hoySV() } = {}) {
    const out = [];
    const items = c.items ?? [];
    if (!c.proveedor_id) out.push({ campo: 'proveedor', texto: 'Elige el proveedor.' });
    if (!String(c.numero ?? '').trim()) out.push({ campo: 'numero', texto: 'Escribe el número del documento.' });
    if (!c.fecha) out.push({ campo: 'fecha', texto: 'Escribe la fecha del documento.' });
    else if (c.fecha > hoy) out.push({ campo: 'fecha', texto: 'La fecha del documento está en el futuro.' });
    if (Number(c.condicion) === 2 && !c.vence) out.push({ campo: 'vence', texto: 'Una compra al crédito necesita la fecha en que vence.' });
    if (!items.length) out.push({ campo: 'items', texto: 'Agrega los productos que llegaron.' });
    items.forEach((it, i) => {
        const n = `Renglón ${i + 1}`;
        if (!it.product_id) out.push({ campo: `item-${i}`, texto: `${n}: elige el producto del catálogo.` });
        if (!(num(it.cantidad) > 0) || !Number.isInteger(num(it.cantidad))) out.push({ campo: `item-${i}`, texto: `${n}: las unidades tienen que ser un número entero.` });
        if (!(num(it.costo_unitario) > 0)) out.push({ campo: `item-${i}`, texto: `${n}: falta el costo.` });
        if (!String(it.lote ?? '').trim() || !it.vence) out.push({ campo: `item-${i}`, texto: `${n}: falta el lote o el vencimiento.` });
        else if (it.vence <= hoy) out.push({ campo: `item-${i}`, texto: `${n}: el lote ${String(it.lote).toUpperCase()} ya está vencido.` });
    });
    const { productos } = totalesCalculados(items, c.tipo_doc);
    const base = r2(num(c.gravada) + num(c.exenta));
    if (items.length && Math.abs(productos - base) > toleranciaDeCuadre(items.length)) {
        out.push({ campo: 'gravada', texto: `Los productos suman ${productos.toFixed(2)} y el documento dice ${base.toFixed(2)} (gravado + exento).` });
    }
    if (c.tipo_doc === '03' && Math.abs(num(c.iva) - r2(num(c.gravada) * IVA)) > 0.02) {
        out.push({ campo: 'iva', texto: `El IVA de un Crédito Fiscal es el 13 % de lo gravado: ${r2(num(c.gravada) * IVA).toFixed(2)}.` });
    }
    if (Math.abs(num(c.total) - totalEsperado(c)) > 0.01) {
        out.push({ campo: 'total', texto: `El total no cuadra: gravado + exento + IVA + percepción − retención = ${totalEsperado(c).toFixed(2)}.` });
    }
    return out;
}

/** El documento del proveedor dentro de lo que se haya subido (a veces viene envuelto con el sello). */
function hallarDte(obj, prof = 0) {
    if (!obj || typeof obj !== 'object' || prof > 3) return null;
    if (obj.identificacion && obj.cuerpoDocumento) return obj;
    for (const v of Object.values(obj)) {
        const d = hallarDte(v, prof + 1);
        if (d) return d;
    }
    return null;
}

/**
 * Lee el JSON de un documento electrónico del proveedor y devuelve la compra
 * lista para revisar. `memoria` es `{ codigo: { product_id, unidades_por } }`
 * (lo que se eligió la vez anterior con ese proveedor).
 *
 * Tres cuentas que el JSON no trae hechas:
 *  - el costo por unidad sale de `ventaGravada + ventaExenta` del renglón, que
 *    ya viene sin su descuento; no de `precioUni`;
 *  - un descuento sobre el TOTAL (`descuGravada`) se reparte entre los
 *    renglones gravados, o los productos no sumarían lo gravado;
 *  - si el proveedor factura por caja y aquí se cuenta por unidad, la memoria
 *    dice cuántas trae, y el costo se divide.
 *
 * Lanza un `Error` con un texto para la pantalla si el archivo no sirve.
 */
export function leerDteDelProveedor(json, { memoria = {} } = {}) {
    const dte = hallarDte(json);
    if (!dte) throw new Error('El archivo no es un documento electrónico: no trae identificación ni productos.');
    const id = dte.identificacion ?? {};
    const tipo = String(id.tipoDte ?? '');
    if (!['01', '03'].includes(tipo)) throw new Error(`Ese documento es de tipo ${tipo || 'desconocido'}: aquí se cargan Créditos Fiscales y Facturas.`);
    const res = dte.resumen ?? {};
    const cuerpo = Array.isArray(dte.cuerpoDocumento) ? dte.cuerpoDocumento : [];
    if (!cuerpo.length) throw new Error('El documento no trae productos.');

    const totalGravada = num(res.totalGravada);
    const descGravada = num(res.descuGravada);
    const factor = totalGravada > 0 && descGravada > 0 ? (totalGravada - descGravada) / totalGravada : 1;

    const items = cuerpo.map((r) => {
        const codigo = String(r.codigo ?? '').trim();
        const recordado = codigo ? memoria[codigo] : null;
        const unidadesPor = Math.max(1, Number(recordado?.unidades_por) || 1);
        const cantidadDoc = num(r.cantidad);
        const neto = num(r.ventaGravada) * factor + num(r.ventaExenta) + num(r.ventaNoSuj);
        const cantidad = Math.round(cantidadDoc * unidadesPor);
        return {
            codigo_proveedor: codigo || null,
            descripcion_proveedor: String(r.descripcion ?? '').trim(),
            product_id: recordado?.product_id ?? null,
            recordado: !!recordado,
            cantidad_doc: cantidadDoc,
            unidades_por: unidadesPor,
            neto: r2(neto),
            cantidad,
            costo_unitario: cantidad > 0 ? r6(neto / cantidad) : 0,
            lote: '',
            vence: '',
        };
    });

    const iva = tipo === '03'
        ? r2((res.tributos ?? []).filter(t => String(t.codigo) === '20').reduce((a, t) => a + num(t.valor), 0))
        : 0;
    const gravada = r2(totalGravada - descGravada);
    const exenta = r2(num(res.totalExenta) - num(res.descuExenta) + num(res.totalNoSuj) - num(res.descuNoSuj));
    const percepcion = r2(num(res.ivaPerci1));
    const retencion = r2(num(res.ivaRete1));
    const condicion = Number(res.condicionOperacion) === 2 ? 2 : 1;
    return {
        emisor: {
            nombre: String(dte.emisor?.nombre ?? '').trim(),
            nit: String(dte.emisor?.nit ?? '').replace(/\D/g, '') || null,
            nrc: String(dte.emisor?.nrc ?? '').replace(/\D/g, '') || null,
        },
        compra: {
            tipo_doc: tipo,
            numero: String(id.numeroControl ?? '').trim().toUpperCase(),
            codigo_generacion: String(id.codigoGeneracion ?? '').trim().toLowerCase() || null,
            fecha: id.fecEmi ?? '',
            condicion,
            gravada, exenta, iva, percepcion, retencion,
            total: r2(gravada + exenta + iva + percepcion - retencion),
        },
        items,
    };
}

/** Aplica una unidad-por-empaque nueva a un renglón que vino del documento. */
export function cambiarUnidadesPor(it, unidadesPor) {
    const u = Math.max(1, Math.floor(Number(unidadesPor) || 1));
    if (!(it.cantidad_doc > 0)) return { ...it, unidades_por: u };
    const cantidad = Math.round(it.cantidad_doc * u);
    return { ...it, unidades_por: u, cantidad, costo_unitario: cantidad > 0 ? r6(it.neto / cantidad) : 0 };
}

// ── Compras a partes relacionadas (borrador 0022) ──────────────────────────
// Entre empresas del mismo grupo el precio tiene que ser el de MERCADO: el que
// se le cobraría a un tercero. Estas son las señales de que no lo es; AVISAN y
// no bloquean — el margen lo decide el contador. La usan la compra y el
// reporte: una sola regla.

/** Tolerancia bajo el mayoreo de Farmalasa antes de avisar (10 %). */
export const TOLERANCIA_MAYOREO = 0.10;

/**
 * `pagado`: costo unitario sin IVA de la compra. `ref`: lo que devuelve
 * `dist_referencias_relacionada` para ese producto. Devuelve los avisos, del
 * más grave al menos: `[{ nivel: 'danger'|'warning', clave, texto }]`.
 */
export function evaluarPrecioRelacionada(pagado, ref) {
    const p = Number(pagado);
    const out = [];
    if (!ref || !(p > 0)) return out;
    const costoF = Number(ref.costo_farmalasa) || 0;
    const mayoreo = Number(ref.mayoreo_sin_iva) || 0;
    const venta = Number(ref.precio_torogoz_sin_iva) || 0;
    const $ = (n) => formatMoney(n);
    if (costoF > 0 && p < costoF - 0.005) {
        out.push({ nivel: 'danger', clave: 'bajo_costo', texto: `Farmalasa lo vendería bajo su costo (${$(costoF)}): es lo primero que revisa Hacienda entre relacionadas.` });
    } else if (mayoreo > 0 && p < mayoreo * (1 - TOLERANCIA_MAYOREO)) {
        out.push({ nivel: 'warning', clave: 'bajo_mayoreo', texto: `Más barato que lo que Farmalasa cobra a terceros (mayoreo ${$(mayoreo)} sin IVA).` });
    }
    if (venta > 0 && p >= venta) {
        out.push({ nivel: 'warning', clave: 'sin_margen', texto: `Torogoz no gana al revenderlo: lo vende a ${$(venta)} sin IVA.` });
    }
    return out;
}
