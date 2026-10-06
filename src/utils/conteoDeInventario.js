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

// ── La lista de conteos: resumen, focos y valor (2026-10-06) ────────────────
// Vivía en `ConteoInventarioView`. La app nativa muestra las mismas tarjetas:
// escritas dos veces, «Sin ajustar» podría contar distinto en cada pantalla.

/**
 * Un conteo CERRADO con diferencias y sin ajuste registrado es trabajo a
 * medias: la diferencia está medida y firmada, pero el stock del sistema sigue
 * mintiendo.
 */
export const faltaAjusteDelConteo = (c) => !!c && c.status === 'CERRADO' && c.total_diferencias > 0 && !c.ajuste_erp_aplicado;

/** Los focos de la lista (las tarjetas que filtran). */
export const FOCOS_CONTEO = {
    ABIERTOS:    (c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status),
    POR_APROBAR: (c) => c.status === 'FINALIZADO',
    SIN_AJUSTE:  faltaAjusteDelConteo,
};

/** Las cuatro tarjetas: Conteos, Abiertos, Por aprobar, Sin ajustar. */
export function resumenDeConteos(conteos) {
    const base = conteos ?? [];
    return {
        total:      base.length,
        abiertos:   base.filter(FOCOS_CONTEO.ABIERTOS).length,
        porAprobar: base.filter(FOCOS_CONTEO.POR_APROBAR).length,
        sinAjuste:  base.filter(FOCOS_CONTEO.SIN_AJUSTE).length,
    };
}

/** Sobrante menos faltante, en dinero: negativo = se perdió producto. */
export const valorNetoDelConteo = (c) => (Number(c?.valor_sobrante) || 0) - (Number(c?.valor_faltante) || 0);

/** Qué pasó en cada fila del historial de un renglón (columna `evento`). */
export const EVENTO_DE_CONTEO = {
    CAPTURA:  { label: 'Capturó',           variante: 'success' },
    EDICION:  { label: 'Editó',             variante: 'warning' },
    BORRADO:  { label: 'Borró la cantidad', variante: 'danger'  },
    RECUENTO: { label: 'Recontó',           variante: 'chart-1' },
    LOTE:     { label: 'Corrigió el lote',  variante: 'chart-9' },
    CIERRE:   { label: 'Cerró sin ubicar',  variante: 'neutral' },
};

// ── Crear un conteo (portal y app) ──────────────────────────────────────────
// Vivía en `NuevoConteoModal`. Tres ejes independientes —qué se cuenta, con
// cuánto detalle y contra qué existencia— y el filtro que viaja al servidor.

export const ALCANCES_DE_CONTEO = [
    { value: 'CICLICO', label: 'Cíclico del mes' },
    { value: 'TOTAL', label: 'Todo el inventario' },
    { value: 'LABORATORIO', label: 'Por laboratorio' },
    { value: 'BAJO_RECETA', label: 'Bajo Receta' },
    { value: 'MANUAL', label: 'Selección manual' },
];
export const MODOS_DE_CONTEO = [
    { value: 'LOTE', label: 'Por lote y vencimiento' },
    { value: 'SIMPLE', label: 'Solo cantidades' },
];
export const FUENTES_DE_CONTEO = [
    { value: 'HOJA', label: 'Según la hoja' },
    { value: 'VIVO', label: 'En vivo' },
];
export const TAMANO_CICLICO_DEFAULT = 200;
export const SEGMENTO_DE_MUESTRA_LABEL = {
    BAJO_RECETA: 'Bajo Receta', A: 'Clase A', B: 'Clase B', C: 'Clase C / sin clasificar',
};
export const SEGMENTO_DE_MUESTRA_ORDEN = ['BAJO_RECETA', 'A', 'B', 'C'];

/**
 * Lo que se le manda a `crear_conteo_inventario` además de sala, modo y
 * fuente, y qué falta para poder crearlo. `productos` = la selección manual.
 */
export function pedidoDeConteo({ scopeType, laboratorioId, tamano, productos = [] }) {
    const tam = parseInt(tamano, 10);
    const falta = scopeType === 'LABORATORIO' && !laboratorioId ? 'Elige el laboratorio.'
        : scopeType === 'MANUAL' && !productos.length ? 'Agrega al menos un producto.'
            : scopeType === 'CICLICO' && (!Number.isInteger(tam) || tam < 1) ? 'Indica cuántos productos.'
                : null;
    return {
        falta,
        scopeFilter: scopeType === 'LABORATORIO' ? { laboratorio_id: parseInt(laboratorioId, 10) }
            : scopeType === 'CICLICO' ? { tamano: tam } : null,
        erpProductIds: scopeType === 'MANUAL' ? productos.map((p) => p.id) : null,
    };
}
