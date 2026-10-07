// Los íconos de VISTAS_REPORTES y LIBROS_VENTAS se quedan en la pantalla del portal
// (`views/distribucion/reportes.js`); acá van las cuentas, que usa también la app.
import { mesSV, correrMes, etiquetaMes } from './fecha';
import { construirLibro, csvRetencionVentas, CSV_RET_VENTAS_HEADERS } from './libroIva';
import { evaluarPrecioRelacionada } from './distribucionCompras';
import { tokenMatch } from './searchUtils';

// Reportes de la distribuidora (borrador 0016): la utilidad bruta y el libro de
// compras. Lo que se calcula acá es presentación —margen, meses, el mapeo al
// generador del libro—; las sumas las hace la base.

export const VISTAS_REPORTES = [
    { key: 'utilidad', label: 'Utilidad' },
    { key: 'ventas', label: 'Libros de ventas' },
    { key: 'compras', label: 'Libro de compras' },
    { key: 'retenciones', label: 'Retenciones' },
    { key: 'relacionadas', label: 'Relacionadas' },
];

/** Los años para el reporte de relacionadas: el actual y los dos anteriores. */
export function aniosRecientes(hoy) {
    const y = Number(String(hoy).slice(0, 4));
    return [y, y - 1, y - 2].map(a => ({ key: String(a), label: String(a) }));
}

/** Los tres libros de ventas (borrador 0021); la pestaña va en `?libro=`. */
export const LIBROS_VENTAS = [
    { key: 'contribuyente', label: 'Contribuyentes' },
    { key: 'consumidor', label: 'Consumidor final' },
    { key: 'anulados', label: 'Anulados' },
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

// ── Lo que armaba la pantalla y ahora usan las dos (portal y app) ─────────

/** Los grupos de la utilidad para un `agrupar`, filtrados por la búsqueda. */
export function gruposDeUtilidad(datos, agrupar, buscar = '') {
    const q = String(buscar ?? '').trim();
    return (datos?.grupos ?? []).filter(g => g.por === agrupar && (!q || tokenMatch(q, g.nombre)));
}

/** La serie diaria de la gráfica «Venta y utilidad por día». */
export function serieDeUtilidad(porDia) {
    return (porDia ?? []).map(d => {
        const venta = Number(d.venta) || 0;
        return { fecha: d.fecha, venta, utilidad: Math.round((venta - (Number(d.costo) || 0)) * 100) / 100 };
    });
}

/** Las compras a relacionadas con su referencia de mercado y sus avisos de precio. */
export function filasRelacionadas(datos, buscar = '') {
    const q = String(buscar ?? '').trim();
    return (datos?.productos ?? [])
        .map(p => ({ ...p, ref: datos?.referencias?.[p.product_id] ?? null }))
        .map(p => ({ ...p, avisos: evaluarPrecioRelacionada(p.pagado_u, p.ref) }))
        .filter(p => !q || tokenMatch(q, p.nombre));
}

/** El archivo de compras a relacionadas del año. */
export function csvRelacionadas(filas, anio) {
    const m = (n) => (n == null ? '' : Number(n).toFixed(4));
    return {
        headers: ['PRODUCTO', 'UNIDADES', 'PAGADO TOTAL', 'PAGADO C/U SIN IVA', 'COSTO FARMALASA C/U', 'MAYOREO FARMALASA C/U SIN IVA', 'VENTA TOROGOZ C/U SIN IVA', 'AVISOS'],
        rows: filas.map(f => [f.nombre, f.unidades, Number(f.pagado).toFixed(2), m(f.pagado_u), m(f.ref?.costo_farmalasa), m(f.ref?.mayoreo_sin_iva),
            m(f.ref?.precio_torogoz_sin_iva), f.avisos.map(a => a.texto).join(' | ')]),
        nombre: `compras-relacionadas-torogoz-${anio}.csv`,
    };
}

/** El archivo de un libro de ventas del mes (contribuyente, consumidor o anulados). */
export function archivoDeLibroDeVentas(libro, datos, mes) {
    const l = construirLibro(libro, { [libro]: datos?.[libro] ?? [] });
    return { headers: l.headers, rows: l.rows, nombre: `${l.base}-torogoz-${mes}.csv` };
}

/** El archivo del libro de compras del mes (el generador de 23 columnas de las farmacias). */
export function archivoDeLibroDeCompras(filas, mes) {
    const l = construirLibro('compras', { compras: comprasParaLibro(filas) });
    return { headers: l.headers, rows: l.rows, nombre: `libro-compras-torogoz-${mes}.csv` };
}

/**
 * Los cuatro listados de retenciones y percepciones del mes, con su total y
 * las filas cortas que se muestran (`[nombre, documento, monto]`).
 */
export function listadosDeRetenciones(ventas, compras) {
    const ret = retencionesDeClientes(ventas?.contribuyente);
    const perc = percepcionesAClientes(ventas?.contribuyente);
    const percProv = anexoDeCompras(compras, 'percepcion');
    const retProv = anexoDeCompras(compras, 'retencion');
    const suma = (xs, k) => xs.reduce((a, x) => a + Number(x[k] || 0), 0);
    return [
        { clave: 'ret', titulo: 'IVA que nos retuvieron', sub: 'Clientes grandes contribuyentes (1 %) — anticipo', n: ret.length, total: suma(ret, 'retencion_iva'),
          datos: ret, filas: ret.map(f => [f.cliente, f.numero_control, f.retencion_iva]) },
        { clave: 'perc', titulo: 'IVA que percibimos', sub: 'A clientes, como agente de percepción — se entera', n: perc.length, total: suma(perc, 'percibido'),
          datos: perc, filas: perc.map(f => [f.cliente, f.numero_control, f.percibido]) },
        { clave: 'percProv', titulo: 'Percepción que nos cobraron', sub: 'Proveedores grandes contribuyentes — anticipo', n: percProv.length, total: suma(percProv, 'percepcion_iva'),
          datos: percProv, filas: percProv.map(f => [f.proveedor, f.documento_numero, f.percepcion_iva]) },
        { clave: 'retProv', titulo: 'Retención que hicimos', sub: 'A proveedores — se entera', n: retProv.length, total: suma(retProv, 'retencion_iva'),
          datos: retProv, filas: retProv.map(f => [f.proveedor, f.documento_numero, f.retencion_iva]) },
    ];
}

/** El archivo de uno de los cuatro listados de `listadosDeRetenciones`. */
export function archivoDeRetencion(listado, mes) {
    const sufijo = `-torogoz-${mes}.csv`;
    if (listado.clave === 'ret') return { headers: CSV_RET_VENTAS_HEADERS, rows: csvRetencionVentas(listado.datos), nombre: `iva-retenido-sobre-ventas${sufijo}` };
    if (listado.clave === 'perc') return { headers: CSV_PERCEPCION_CLIENTES_HEADERS, rows: csvPercepcionClientes(listado.datos), nombre: `iva-percibido-a-clientes${sufijo}` };
    const tab = listado.clave === 'percProv' ? 'percepcion' : 'retencion';
    const l = construirLibro(tab, { [tab]: listado.datos });
    return { headers: l.headers, rows: l.rows, nombre: `${l.base}${sufijo}` };
}
