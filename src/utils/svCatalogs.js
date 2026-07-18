// Catálogo mínimo MH (CAT-012 Departamento). Municipio se muestra como
// código crudo en v1 — el catálogo completo (262 municipios) no aporta
// suficiente valor todavía para el costo de mantenerlo.
export const DEPARTAMENTOS_SV = {
    '01': 'Ahuachapán',
    '02': 'Santa Ana',
    '03': 'Sonsonate',
    '04': 'Chalatenango',
    '05': 'La Libertad',
    '06': 'San Salvador',
    '07': 'Cuscatlán',
    '08': 'La Paz',
    '09': 'Cabañas',
    '10': 'San Vicente',
    '11': 'Usulután',
    '12': 'San Miguel',
    '13': 'Morazán',
    '14': 'La Unión',
};

export function departamentoLabel(codigo) {
    if (!codigo) return null;
    return DEPARTAMENTOS_SV[codigo] || `Depto. ${codigo}`;
}
