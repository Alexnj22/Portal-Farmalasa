// Utilidad genérica de export CSV (bloque 7B.5) — primera extracción
// compartida del patrón ya usado ad-hoc en TabMinMax.jsx (`exportCsv`):
// BOM + separador `;` + CRLF, formato Excel-friendly para locale es-SV.
// Sin lógica de negocio — solo la mecánica de armar y descargar el archivo.
//
// Los tres bytes invisibles son una DECISIÓN, no un default (C7/H20, documentado
// en `docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md` §9). Los libros de IVA
// se cotejan contra el archivo de referencia con un `diff`, y un diff que se
// ensucia con diferencias de codificación deja de servir para lo único que se le
// pide: mostrar diferencias de DATOS.
//
//   BOM `EF BB BF`  sin él Excel en es-SV abre en Latin-1 y `PEÑA` sale `PEÃ‘A`
//   CRLF `0D 0A`    con LF a secas el diff marca TODAS las líneas como distintas
//   sin salto final el archivo termina en el último dato
//
// La tercera es la que se escapa: `join('\r\n')` NO agrega terminador al final,
// y hay que dejarlo así. El reflejo natural —`map(l => l + '\r\n')`— agrega una
// línea vacía que nadie ve en pantalla y que Excel lee como una fila más. En un
// libro fiscal, una fila en blanco es una fila del libro.

import { registrarEgreso } from '../data/egreso';

function escapeCell(value) {
    if (value == null) return '';
    const str = String(value);
    return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * `headers` en `null` escribe el archivo SIN fila de encabezado. Hace falta para
 * los libros de IVA: los reportes que replican arrancan directo en datos, y una
 * fila de rótulos de más los desalinea contra el archivo con el que se comparan.
 *
 * `modulo` NO es opcional: es lo que hace legible la línea base del registro de
 * egreso (Fase 1 del blindaje). Si falta, el archivo se descarga igual —cortarle
 * la descarga a alguien por un descuido de programación sería peor— pero el
 * egreso queda anotado como `sin-declarar`, que es un hallazgo VISIBLE en la
 * propia tabla en vez de un hueco silencioso. Una línea base con agujeros que
 * nadie sospecha es peor que ninguna.
 *
 * @param {string[]|null} headers
 * @param {Array<Array<string|number>>} rows
 * @param {string} filename
 * @param {string} modulo  de dónde sale, en términos del portal (`libros_iva`, `personal`, …)
 */
export function exportCsv(headers, rows, filename, modulo) {
    const blob = new Blob([buildCsvText(headers, rows)], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);

    if (!modulo) console.error(`[exportCsv] "${filename}" se descargó sin declarar módulo.`);
    registrarEgreso(modulo || 'sin-declarar', {
        formato: 'csv',
        filas: Array.isArray(rows) ? rows.length : null,
        detalle: { archivo: filename },
    });
}

/**
 * El MISMO texto que escribe `exportCsv`, devuelto en vez de descargado. Existe
 * para el ZIP de los libros de IVA, que necesita 40+ archivos en una sola
 * descarga y no puede disparar 40 clicks.
 *
 * Es una función aparte y `exportCsv` la usa, en lugar de que el ZIP se arme el
 * texto por su cuenta: dos transcripciones del mismo archivo se separan sola la
 * primera vez que alguien toca una — y acá la diferencia serían los tres bytes
 * del BOM o el CRLF, que es exactamente lo que rompe el `diff` contra el archivo
 * de referencia.
 *
 * @param {string[]|null} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function buildCsvText(headers, rows) {
    const SEP = ';';
    const todas = headers == null ? rows : [headers, ...rows];
    const lines = todas.map(row => row.map(escapeCell).join(SEP));
    return '﻿' + lines.join('\r\n');
}
