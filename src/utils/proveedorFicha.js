/**
 * Los rótulos de la ficha de un proveedor — vivían dentro de
 * `FormProveedorDetail` del portal; se mudaron el 2026-10-06 para que la app
 * diga exactamente lo mismo.
 */

// «Percibe 1%» es tri-estado: automático (lo deciden sus propios DTE,
// ivaPerci1 > 0) o una corrección manual que congela el campo contra futuros
// DTE. Un booleano plano lo fijaba en cualquier guardado.
export const PERCIBE_OPTIONS = [
    { value: 'auto', label: 'Automático (según sus DTE)' },
    { value: 'si',   label: 'Sí, percibe 1%' },
    { value: 'no',   label: 'No percibe' },
];
export const percibeToOption = (override) => (override === null || override === undefined ? 'auto' : (override ? 'si' : 'no'));
export const optionToPercibe = (v) => (v === 'auto' ? null : v === 'si');

// La clase contable sale de la `clase` de la categoría asignada: es la del
// GASTO, no la del proveedor.
export const CLASE_LABELS = {
    costo: 'Costo (Inventario)',
    gasto_operativo: 'Gasto operativo',
    gasto_admin: 'Gasto administrativo',
    otro: 'Otro',
};

// El régimen fiscal real — derivado en el servidor de si tiene NRC; nunca se
// edita a mano.
export const REGIMEN_LABELS = {
    contribuyente: 'Contribuyente de IVA',
    sujeto_excluido: 'Sujeto Excluido de IVA',
};
export const REGIMEN_HINT = {
    contribuyente: 'Tiene NRC — da derecho a crédito fiscal de IVA (Art. 65 Ley IVA)',
    sujeto_excluido: 'Sin NRC — no da crédito fiscal (Art. 119 CT); si es persona natural por un servicio, aplica retención de Renta 10% (Art. 156 CT)',
};

/** Un teléfono de El Salvador listo para llamar o abrir en WhatsApp (sólo dígitos, con 503). */
export function telefonoParaMarcar(t) {
    const d = String(t ?? '').replace(/\D/g, '');
    if (d.length === 8) return `503${d}`;
    if (d.length === 11 && d.startsWith('503')) return d;
    return d.length >= 8 ? d : null;
}
