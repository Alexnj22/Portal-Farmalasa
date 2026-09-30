import { TrendingUp, BookOpen, BookText, Users, Store, FileX2, Handshake } from 'lucide-react';
import { mesSV, correrMes, etiquetaMes } from '@nucleo/utils/fecha';

// Reportes de la distribuidora (borrador 0016): la utilidad bruta y el libro de
// compras. Lo que se calcula acá es presentación —margen, meses, el mapeo al
// generador del libro—; las sumas las hace la base.

export const VISTAS_REPORTES = [
    { key: 'utilidad', label: 'Utilidad', icon: TrendingUp },
    { key: 'ventas', label: 'Libros de ventas', icon: BookText },
    { key: 'compras', label: 'Libro de compras', icon: BookOpen },
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
