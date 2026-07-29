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
    if (!tipoDte) return '—'; // documento confirmado sin JSON — nunca se supo el tipo
    return DTE_TYPE_LABELS[tipoDte] || `Tipo ${tipoDte}`;
}

// Tipos cuyo `emisor` ES el proveedor que nos vendió — espejo de
// TIPOS_DTE_CON_PROVEEDOR en supabase/functions/_shared/proveedorFromDte.ts.
// 01/03/05/06 comparten el bloque emisor; 14 (FSE) usa sujetoExcluido.
const TIPOS_CON_PROVEEDOR = new Set(['01', '03', '05', '06', '14']);

// H4 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): en 07/08/09 el emisor es un
// intermediario financiero o un cliente que nos retiene, NO un proveedor —
// el sync nunca les asigna proveedor_id, a propósito. Sin esto la UI los
// contaba como "pendiente de emparejar" y ofrecía un botón que no podía
// resolver nada: 143 documentos tipo 09 marcados como tarea imposible,
// creciendo ~2/día. Un documento sin tipo (confirmado sin JSON) SÍ admite
// proveedor manual — nunca se supo qué era.
export function dteAdmiteProveedor(tipoDte) {
    if (!tipoDte) return true;
    return TIPOS_CON_PROVEEDOR.has(tipoDte);
}


