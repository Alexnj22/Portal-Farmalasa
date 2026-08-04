// Utilidades compartidas de Metas: meses en 'YYYY-MM' contados en el DÍA DE
// NEGOCIO de El Salvador (UTC-6 fijo, la misma convención -6h del resto del
// portal) — con la fecha UTC, desde las 18:00 el portal ya estaría "mañana".

export function ymHoySV() {
    const d = new Date(Date.now() - 6 * 3600_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function ymSumar(ym, meses) {
    const [y, m] = ym.split('-').map(Number);
    const idx = y * 12 + (m - 1) + meses;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function ymLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MESES_LARGO[m - 1]} ${y}`;
}

export function ymLabelCorto(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MESES_CORTO[m - 1]} ${y}`;
}

// El primer mes con ventas sincronizadas en el portal.
export const YM_INICIO_HISTORIA = '2025-05';

// Las salas que venden, en el orden del tablero. Es el mismo conjunto que
// `erp_sucursal_map WHERE NOT es_bodega` y que devuelven todos los RPC del
// módulo — Bodega no vende, así que no tiene meta. Vive acá porque lo necesitan
// el módulo Y el widget del Inicio: tenerlo dos veces es tenerlo mal una vez.
export const SALAS_VENTA = [2, 4, 25, 27, 28, 29];

// Config del tramo del bono → cómo se pinta. El texto habla del negocio
// («Bono completo»), nunca de la tubería.
export const TRAMO_CFG = {
    completo: { label: 'Bono completo', variante: 'success', textCls: 'text-success-text' },
    medio:    { label: 'Medio bono',    variante: 'warning', textCls: 'text-warning-text' },
    nada:     { label: 'Sin bono',      variante: 'danger',  textCls: 'text-danger-text' },
};
