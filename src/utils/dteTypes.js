// Catálogo de tipos de DTE (Ministerio de Hacienda El Salvador). Tipo
// desconocido → mostrar el código crudo, nunca ocultar la fila.
export const DTE_TYPE_LABELS = {
    '01': 'Factura',
    '03': 'Crédito Fiscal (CCF)',
    '04': 'Nota de Remisión',
    '05': 'Nota de Crédito',
    '06': 'Nota de Débito',
    '07': 'Comprobante de Retención',
    '08': 'Comprobante de Liquidación',
    '09': 'Doc. Contable de Liquidación',
    '11': 'Factura de Exportación',
    '14': 'Factura Sujeto Excluido',
    '15': 'Comprobante de Donación',
};

export function dteTypeLabel(tipoDte) {
    return DTE_TYPE_LABELS[tipoDte] || `Tipo ${tipoDte}`;
}

export const DTE_TYPE_OPTIONS = Object.entries(DTE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
