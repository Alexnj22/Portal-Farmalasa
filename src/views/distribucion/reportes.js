import { TrendingUp, BookOpen, BookText, Users, Store, FileX2, Handshake, Percent } from 'lucide-react';
import { mesSV, correrMes, etiquetaMes } from '@nucleo/utils/fecha';

// Reportes de la distribuidora (borrador 0016): la utilidad bruta y el libro de
// compras. Lo que se calcula acá es presentación —margen, meses, el mapeo al
// generador del libro—; las sumas las hace la base.

export const VISTAS_REPORTES = [
    { key: 'utilidad', label: 'Utilidad', icon: TrendingUp },
    { key: 'ventas', label: 'Libros de ventas', icon: BookText },
    { key: 'compras', label: 'Libro de compras', icon: BookOpen },
    { key: 'retenciones', label: 'Retenciones', icon: Percent },
    { key: 'relacionadas', label: 'Relacionadas', icon: Handshake },
];

/** Los años para el reporte de relacionadas: el actual y los dos anteriores. */
export function aniosRecientes(hoy) {
    const y = Number(String(hoy).slice(0, 4));
    return [y, y - 1, y - 2].map(a => ({ key: String(a), label: String(a) }));
}

/** Los tres libros de ventas (borrador 0021); la pestaña va en `?libro=`. */
export const LIBROS_VENTAS = [
    { key: 'contribuyente', label: 'Contribuyentes', icon: Users },
    { key: 'consumidor', label: 'Consumidor final', icon: Store },
    { key: 'anulados', label: 'Anulados', icon: FileX2 },
];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Totales del libro de contribuyentes. Las notas de crédito (05) RESTAN: en el
 * archivo van en positivo con su tipo, pero lo que se declara es el neto.
 */
export function totalesContribuyente(filas) {
    const t = { gravadas: 0, exentas: 0, debito: 0, percibido: 0, retenido: 0, documentos: 0, notas: 0 };
    for (const f of filas ?? []) {
        const s = f.tipo_dte === '05' ? -1 : 1;
        t.gravadas += s * Number(f.ventas_gravadas || 0);
        t.exentas += s * Number(f.ventas_exentas || 0);
        t.debito += s * Number(f.debito_fiscal || 0);
        t.percibido += s * Number(f.percibido || 0);
        t.retenido += s * Number(f.retenido || 0);
        if (f.tipo_dte === '05') t.notas += 1; else t.documentos += 1;
    }
    for (const k of ['gravadas', 'exentas', 'debito', 'percibido', 'retenido']) t[k] = r2(t[k]);
    return t;
}

/** Totales del libro de consumidor final (la gravada ya trae el IVA adentro). */
export function totalesConsumidor(filas) {
    const t = { gravadas: 0, exentas: 0, total: 0, documentos: 0, dias: (filas ?? []).length };
    for (const f of filas ?? []) {
        t.gravadas += Number(f.ventas_gravadas || 0);
        t.exentas += Number(f.ventas_exentas || 0);
        t.total += Number(f.total_diario || 0);
        t.documentos += Number(f.documentos || 0);
    }
    for (const k of ['gravadas', 'exentas', 'total']) t[k] = r2(t[k]);
    // El IVA contenido en la venta a consumidor: lo que se declara como débito.
    t.debito = r2(t.gravadas - t.gravadas / 1.13);
    return t;
}

export const AGRUPAR_UTILIDAD = [
    { value: 'producto', label: 'Por producto' },
    { value: 'cliente', label: 'Por cliente' },
    { value: 'ruta', label: 'Por ruta' },
    { value: 'vendedor', label: 'Por vendedor' },
];

/** Margen sobre la venta, en %. `null` si no hay venta con costo (no es un 0 %). */
export function margen(venta, costo) {
    const v = Number(venta) || 0;
    if (v <= 0) return null;
    return Math.round(((v - (Number(costo) || 0)) / v) * 1000) / 10;
}

/** Los últimos `n` meses como pestañas `{ key: 'YYYY-MM', label }`, el actual primero. */
export function mesesRecientes(n = 13, mes = mesSV()) {
    return Array.from({ length: n }, (_, i) => {
        const key = correrMes(mes, -i);
        return { key, label: etiquetaMes(key) };
    });
}

/**
 * Las compras de `dist_libro_compras` con los nombres de campo que espera
 * `construirLibro('compras', …)` de `utils/libroIva.js` — el MISMO generador
 * de 23 columnas del libro de las farmacias, para que los dos archivos no
 * puedan diferir en formato.
 *
 * Una diferencia de origen, anotada: el ERP de las farmacias manda lo gravado
 * CON la percepción adentro y el libro la resta; acá `gravada` ya es la base
 * (así se captura y así la valida `dist_recibir_compra`), así que va directo.
 */
export function comprasParaLibro(filas) {
    return (filas ?? []).filter(f => f.en_libro).map(f => ({
        fecha: f.fecha,
        // El número de control va sin guiones en el libro (DTE03M001P001…), como en el de las farmacias.
        documento_numero: String(f.numero ?? '').replace(/-/g, ''),
        nit: f.nit || f.nrc || '',
        proveedor: f.proveedor,
        compras_exentas: f.exenta,
        compras_gravadas: f.gravada,
        credito_fiscal: f.iva,
        total: f.total,
        percepcion_iva: f.percepcion,
    }));
}

/** Totales del libro (sólo lo que entra al libro). */
export function totalesDelLibro(filas) {
    const t = { exenta: 0, gravada: 0, iva: 0, percepcion: 0, retencion: 0, total: 0, documentos: 0 };
    for (const f of filas ?? []) {
        if (!f.en_libro) continue;
        for (const k of ['exenta', 'gravada', 'iva', 'percepcion', 'retencion', 'total']) t[k] += Number(f[k]) || 0;
        t.documentos += 1;
    }
    for (const k of ['exenta', 'gravada', 'iva', 'percepcion', 'retencion', 'total']) t[k] = Math.round(t[k] * 100) / 100;
    return t;
}

// ── Retenciones y percepciones del mes ─────────────────────────────────────
// Cuatro listados, todos derivados de filas que ya existen (libros de ventas
// 0021 y libro de compras 0016): no hay tabla ni consulta nueva. Las notas de
// crédito restan (van en negativo), porque corrigen el documento que sí tuvo
// retención o percepción.

const fmtDdMm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '');
const menosSiNota = (f, n) => (f.tipo_dte === '05' ? -1 : 1) * (Number(n) || 0);
const TIPO_EN_ARCHIVO = { '03': 'CCF', '05': 'NC', '06': 'ND', '01': 'FACTURA' };

/** El IVA que NOS retuvieron (clientes grandes contribuyentes), en el formato de las farmacias (`retencionVentas`). */
export function retencionesDeClientes(contribuyente) {
    return (contribuyente ?? []).filter(f => Number(f.retenido) > 0).map(f => ({
        fecha: f.fecha, cliente: f.cliente, nrc: f.nrc, nit: f.nit,
        tipo_documento: TIPO_EN_ARCHIVO[f.tipo_dte] ?? f.tipo_dte, correlativo: f.numero_control, numero_control: f.numero_control,
        codigo_generacion: f.codigo_generacion, sello_recepcion: f.sello_recepcion,
        monto_sujeto: menosSiNota(f, f.ventas_gravadas), retencion_iva: menosSiNota(f, f.retenido),
        total: menosSiNota(f, Number(f.ventas_gravadas) + Number(f.debito_fiscal)), anulada: false,
    }));
}

/** El IVA que PERCIBIMOS a clientes (la distribuidora como agente de percepción). */
export function percepcionesAClientes(contribuyente) {
    return (contribuyente ?? []).filter(f => Number(f.percibido) > 0).map(f => ({
        fecha: f.fecha, cliente: f.cliente, nrc: f.nrc, tipo: TIPO_EN_ARCHIVO[f.tipo_dte] ?? f.tipo_dte,
        numero_control: f.numero_control, base: menosSiNota(f, f.ventas_gravadas), percibido: menosSiNota(f, f.percibido),
    }));
}
export const CSV_PERCEPCION_CLIENTES_HEADERS = ['N.', 'FECHA', 'CLIENTE', 'NRC', 'TIPO', 'NUMERO DE CONTROL', 'BASE', 'IVA PERCIBIDO'];
export const csvPercepcionClientes = (filas) => {
    const d = (n) => (Number(n) || 0).toFixed(2);
    return [
        ...filas.map((r, i) => [i + 1, fmtDdMm(r.fecha), r.cliente || '', String(r.nrc || '').replace(/-/g, ''), r.tipo, r.numero_control, d(r.base), d(r.percibido)]),
        ['TOTALES', '', '', '', '', '', d(filas.reduce((a, r) => a + r.base, 0)), d(filas.reduce((a, r) => a + r.percibido, 0))],
    ];
};

/**
 * Lo que los PROVEEDORES nos percibieron o les retuvimos, con los nombres de
 * campo del anexo de las farmacias (`construirLibro('percepcion'|'retencion')`).
 */
export function anexoDeCompras(compras, clave) {
    const campo = clave === 'percepcion' ? 'percepcion_iva' : 'retencion_iva';
    const origen = clave === 'percepcion' ? 'percepcion' : 'retencion';
    return (compras ?? []).filter(c => Number(c[origen]) > 0).map(c => ({
        fecha: c.fecha, proveedor: c.proveedor, nit: c.nit || c.nrc || '',
        documento_tipo: c.tipo_doc === '03' ? 'CCF' : 'FACTURA',
        documento_numero: String(c.numero ?? '').replace(/-/g, ''),
        monto_sujeto: c.gravada, [campo]: c[origen],
    }));
}

/**
 * El resumen del mes para el contador. REFERENCIAL: la liquidación del IVA la
 * hace él. Débito (contribuyentes + consumidor final) − crédito (compras); lo
 * que nos retuvieron o percibieron son anticipos que se restan, y lo que
 * percibimos a clientes es impuesto que se entera.
 */
export function resumenFiscal({ tc, tf, compras }) {
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const credito = r2((compras ?? []).filter(c => c.en_libro).reduce((a, c) => a + Number(c.iva || 0), 0));
    const percNos = r2((compras ?? []).reduce((a, c) => a + Number(c.percepcion || 0), 0));
    const debito = r2(Number(tc.debito) + Number(tf.debito));
    return {
        debito, credito, retenidoNos: r2(tc.retenido), percibidoNos: percNos, percibidoAClientes: r2(tc.percibido),
        impuesto: r2(debito - credito),
    };
}
