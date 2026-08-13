// ── Catálogos del anexo de compras F-07 v14 (§3) + Art. 65 LIVA ──────────────
//
// Viven acá y no dentro de una vista porque los usan DOS pantallas: la ficha del
// proveedor (`FormProveedorDetail`) y el panel de revisión por regla
// (`PanelDeducibilidad`). Duplicarlos es la forma más barata de que se
// desincronicen — el mismo argumento que CLAUDE.md hace para los catálogos que
// son tabla, sólo que estos no son tabla: salen del manual del formulario y sus
// códigos son los que el CHECK de `proveedores_maestro` hace cumplir.
//
// Si un valor cambia acá, tiene que cambiar el CHECK. No al revés.

export const CLASIFICACION_OPTIONS = [
    { value: '1', label: 'Costo' },
    { value: '2', label: 'Gasto' },
];

export const SECTOR_OPTIONS = [
    { value: '1', label: 'Industria' },
    { value: '2', label: 'Comercio' },
    { value: '3', label: 'Agropecuaria' },
    { value: '4', label: 'Servicios, profesiones, artes y oficios' },
];

// La matriz de la página 21 del manual: con Costo sólo se admiten los tipos 4-7
// y con Gasto sólo 1-3. La hace cumplir un CHECK en la base; `clase` es lo que
// deja reflejarla en la UI para no ofrecer una combinación que el servidor
// rechaza (1 = Costo, 2 = Gasto).
export const TIPO_CG_TODOS = [
    { value: '1', label: 'Gastos de venta', clase: 2 },
    { value: '2', label: 'Gastos de administración', clase: 2 },
    { value: '3', label: 'Gastos financieros', clase: 2 },
    { value: '4', label: 'Costo de artículos importados', clase: 1 },
    { value: '5', label: 'Costo de artículos comprados en el país', clase: 1 },
    { value: '6', label: 'Costos indirectos de fabricación', clase: 1 },
    { value: '7', label: 'Mano de obra', clase: 1 },
];

export const DEDUCIBLE_OPTIONS = [
    { value: 'si', label: 'Sí, da crédito fiscal' },
    { value: 'no', label: 'No es deducible' },
];

// Los tres estados NO son cosmética. El libro de compras sólo usa 'confirmada':
// una propuesta es lo que dedujo el sistema del código de actividad, y que el
// sistema proponga no es que el sistema decida.
export const ESTADO_CLASIF = {
    pendiente:  { label: 'Sin clasificar', tone: 'text-warning-text bg-warning/10 border-warning/25' },
    propuesta:  { label: 'Propuesta — falta confirmar', tone: 'text-brand-text bg-brand/10 border-brand/25' },
    confirmada: { label: 'Confirmada', tone: 'text-success-text bg-success/10 border-success/25' },
};

// Sólo los tipos admitidos por la clasificación elegida. Sin clasificación
// devuelve todos — es lo que hacía el filtro inline de la ficha.
export function tiposCostoGasto(clasificacion) {
    if (!clasificacion) return TIPO_CG_TODOS;
    return TIPO_CG_TODOS.filter(t => t.clase === Number(clasificacion));
}

const etiqueta = (lista, v) => (v == null ? null : lista.find(o => o.value === String(v))?.label || null);

export const clasificacionLabel = (v) => etiqueta(CLASIFICACION_OPTIONS, v);
export const sectorLabel        = (v) => etiqueta(SECTOR_OPTIONS, v);
export const tipoCostoGastoLabel = (v) => etiqueta(TIPO_CG_TODOS, v);

// Dinero del portal: siempre con separador de miles y dos decimales. Un crédito
// fiscal sin centavos no es el mismo número.
export const fmtMoneda = (n) =>
    `$${Number(n || 0).toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
