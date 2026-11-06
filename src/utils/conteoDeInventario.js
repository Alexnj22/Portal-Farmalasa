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
export const faltaAjusteDelConteo = (c) => {
    if (!c || c.status !== 'CERRADO') return false;
    // El que ajusta el inventario se aplica solo: le falta ajuste sólo si algún
    // producto no se pudo aplicar (2026-11-06). Sin esto figuraba «sin ajustar»
    // para siempre, porque nadie registra a mano un ajuste que ya hizo el portal.
    if (c.aplica_en_caja) return c.caja_estado === 'CON_PENDIENTES';
    return c.total_diferencias > 0 && !c.ajuste_erp_aplicado;
};

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
    BAJO_RECETA: 'Antibióticos', A: 'Clase A', B: 'Clase B', C: 'Clase C / sin clasificar',
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

// ── En qué se cuenta un renglón, y qué pide cada producto (2026-11-06) ──────
// Auditoría del conteo que ajusta el inventario: el renglón decía «CAJA» y
// nada más, y en el inventario conviven 3,258 «CAJA 1x1» con 273 «CAJA 1x100».
// Contar pastillas donde se esperaban cajas se multiplica por 100 al ajustar.

const PLURAL_DE = { UNIDAD: 'unidades', BLISTER: 'blísteres', SOBRE: 'sobres', LATA: 'latas' };

/** Cuántas unidades trae la presentación del renglón (`factor`, o el «1xN» del detalle). */
export function factorDelRenglon(item) {
    const f = Number(item?.factor);
    if (Number.isInteger(f) && f > 0) return f;
    const m = String(item?.detalle ?? '').match(/^\s*1\s*[xX]\s*(\d+)\s*$/);
    return m ? Number(m[1]) : null;
}

/** «CAJA», «BLISTER X 10» → «cajas», «blísteres». */
export function pluralDePresentacion(presentacion) {
    const base = String(presentacion ?? '').trim().toUpperCase().replace(/\s*X\s*\d+.*$/, '').trim();
    if (!base) return 'unidades';
    if (PLURAL_DE[base]) return PLURAL_DE[base];
    const minus = base.toLowerCase();
    if (/[aeiouáéíóú]$/.test(minus)) return `${minus}s`;
    if (minus.endsWith('z')) return `${minus.slice(0, -1)}ces`;
    return `${minus}es`;
}

/**
 * En qué se cuenta un renglón, dicho para quien está frente al estante:
 * «Cajas de 100», «Blísteres de 10», «Unidades». `nombre` es el plural suelto,
 * para el campo («¿cuántas cajas?»).
 */
export function unidadDeConteo(item) {
    const nombre = pluralDePresentacion(item?.presentacion);
    const factor = factorDelRenglon(item);
    const Nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    const texto = factor && factor > 1 && nombre !== 'unidades' ? `${Nombre} de ${factor}` : Nombre;
    return { nombre, factor, texto };
}

/** «Sin lote asignado»: vacío o GENERICO. */
export const esLoteGenerico = (lote) => {
    const t = String(lote ?? '').trim();
    return !t || /^gen[eé]rico$/i.test(t);
};

/**
 * Qué pide el producto al agregarlo o corregirlo en un conteo por lote. La
 * misma regla la aplica la base (`agregar_item_conteo`): el lote sólo si el
 * producto lo lleva, y el vencimiento si lo lleva o si es perecedero.
 */
export const reglaDeLoteYVence = (producto) => ({
    pideLote: !!producto?.regulado,
    pideVence: !!producto?.regulado || !!producto?.perecedero,
});

/** Una línea del plan de ajuste, en palabras: «+10 lote L1 (vence 02/2028)». */
export function rotuloDeAjuste(linea) {
    const u = Number(linea?.unidades) || 0;
    const lote = esLoteGenerico(linea?.lote) ? 'sin lote asignado' : `lote ${linea.lote}`;
    const [a, m] = String(linea?.vence ?? '').split('-');
    const vence = a && m ? ` (vence ${m}/${a})` : '';
    return `${u > 0 ? '+' : '−'}${Math.abs(u)} ${u === 1 || u === -1 ? 'unidad' : 'unidades'} · ${lote}${vence}`;
}

/** Los motivos por los que un producto no se puede ajustar, en el orden en que se resuelven. */
export const PROBLEMA_DE_AJUSTE = {
    A_MEDIO_CONTAR: 'A medio contar',
    SOBRA_SIN_LOTE: 'Sobra sin lote',
    FALTA_VENCE: 'Falta vencimiento',
    SIN_FACTOR: 'Presentación sin contenido',
    VENTA_CERCA: 'Venta al contar',
};

/**
 * Avance de los regulados que siguen con existencia «sin lote» (2026-11-06),
 * sumado sobre las sucursales que devuelve `get_regulados_sin_lote` (todas, o
 * sólo `branchId`). `limpios` es el porcentaje de regulados que ya tienen toda
 * su existencia en un lote: el número que sube conteo a conteo.
 */
export function avanceSinLote(sucursales, branchId = null) {
    const filas = (sucursales ?? []).filter((s) => !branchId || String(s.branch_id) === String(branchId));
    const regulados = filas.reduce((n, s) => n + (Number(s.regulados) || 0), 0);
    const sinLote = filas.reduce((n, s) => n + (Number(s.sin_lote) || 0), 0);
    const limpios = regulados ? Math.floor(((regulados - sinLote) / regulados) * 100) : 100;
    return { regulados, sinLote, limpios, sucursal: filas.length === 1 ? filas[0].sucursal : null };
}
