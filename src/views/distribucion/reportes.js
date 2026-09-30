import { TrendingUp, BookOpen } from 'lucide-react';
import { mesSV, correrMes, etiquetaMes } from '@nucleo/utils/fecha';

// Reportes de la distribuidora (borrador 0016): la utilidad bruta y el libro de
// compras. Lo que se calcula acá es presentación —margen, meses, el mapeo al
// generador del libro—; las sumas las hace la base.

export const VISTAS_REPORTES = [
    { key: 'utilidad', label: 'Utilidad', icon: TrendingUp },
    { key: 'compras', label: 'Libro de compras', icon: BookOpen },
];

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
