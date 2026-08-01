// Utilidad genérica de export CSV (bloque 7B.5) — primera extracción
// compartida del patrón ya usado ad-hoc en TabMinMax.jsx (`exportCsv`):
// BOM + separador `;` + CRLF, formato Excel-friendly para locale es-SV.
// Sin lógica de negocio — solo la mecánica de armar y descargar el archivo.

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
 * @param {string[]|null} headers
 * @param {Array<Array<string|number>>} rows
 * @param {string} filename
 */
export function exportCsv(headers, rows, filename) {
    const SEP = ';';
    const todas = headers == null ? rows : [headers, ...rows];
    const lines = todas.map(row => row.map(escapeCell).join(SEP));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}
