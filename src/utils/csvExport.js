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
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @param {string} filename
 */
export function exportCsv(headers, rows, filename) {
    const SEP = ';';
    const lines = [headers, ...rows].map(row => row.map(escapeCell).join(SEP));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}
