/**
 * La regla de un conteo de inventario que se aplica al guardar un renglón y al
 * mostrar un conteo. Vivía dentro de `views/inventario/ConteoDetailView.jsx` y
 * `views/ConteoInventarioView.jsx`; se mudó el 2026-10-02 para que la app del
 * teléfono cuente con la MISMA regla.
 */

/** El alcance de un conteo, en palabras. */
export const ALCANCE_CONTEO = { TOTAL: 'Total', LABORATORIO: 'Por laboratorio', BAJO_RECETA: 'Bajo Receta', MANUAL: 'Manual', CICLICO: 'Cíclico del mes' };

export const ESTADO_CONTEO = { BORRADOR: 'Borrador', EN_PROGRESO: 'En progreso', FINALIZADO: 'Finalizado', CERRADO: 'Cerrado' };

/** Los filtros de la lista de productos. Los de diferencia y no ubicados sólo existen si el rol ve el sistema. */
export const FILTROS_CONTEO = [
    { key: 'TODOS', label: 'Todos' },
    { key: 'PENDIENTES', label: 'Pendientes' },
    { key: 'DIFERENCIA', label: 'Con diferencia', soloConSistema: true },
    { key: 'SIN_UBICAR', label: 'No ubicados', soloConSistema: true },
];

/** Un conteo se puede contar mientras está en borrador o en progreso. */
export const conteoEditable = (conteo) => !!conteo && ['BORRADOR', 'EN_PROGRESO'].includes(conteo.status);

/** La cantidad física es un entero de 0 o más (o vacía, que deshace el conteo del renglón). */
export function cantidadValida(valor) {
    if (valor === '' || valor === null || valor === undefined) return true;
    const n = Number(valor);
    return Number.isInteger(n) && n >= 0;
}

/**
 * Lo que se le manda a `guardar_conteo_item`: vacío deja el renglón PENDIENTE,
 * un número lo da por CONTADO. «No ubicado» es otra acción: físico 0 y
 * SIN_UBICAR, para que no se confunda con «conté cero».
 */
export function guardadoDelRenglon(valor, nota = '') {
    const fisico = valor === '' || valor === null || valor === undefined ? null : Number(valor);
    return { fisicoCantidad: fisico, nota: String(nota || '').trim() || null, estadoItem: fisico !== null ? 'CONTADO' : 'PENDIENTE' };
}
export const noUbicado = (nota = '') => ({ fisicoCantidad: 0, nota: String(nota || '').trim() || null, estadoItem: 'SIN_UBICAR' });
