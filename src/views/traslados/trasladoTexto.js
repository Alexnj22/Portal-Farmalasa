// Cómo se lee un traslado: la fecha y el resumen de lo que se pide.
//
// Aparte de `FilasTraslado.jsx` porque son funciones puras y ese archivo
// exporta componentes: mezclarlos rompe el fast refresh de Vite (lo dice
// `react-refresh/only-export-components`, y con razón — un archivo que exporta
// las dos cosas se recarga entero en cada tecla).

export const fmtCuando = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    return mismoDia
        ? d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

// Sus tres usos son vencimientos de lote, que vienen como fecha sin hora
// ('2027-11-01'). Leída como UTC y pintada en hora local retrocedía un día —y
// con el día 01, que es el caso de casi todas, retrocedía un MES: «31 oct 27»
// por un lote que vence el 1 de noviembre. Se arma en hora local, como en
// `pedidoPrint.js`, para que ninguna de las dos pantallas mienta.
export const fmtFechaLarga = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' });
};

/** Lo que se pide, en una línea legible. */
export function resumenItems(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (items.length === 0) return 'Sin detalle';
    if (items.length === 1) {
        const i = items[0];
        return `${i.cantidad} ${i.presentacion_tipo} · ${i.descripcion ?? i.erp_product_id}`;
    }
    return `${items.length} productos · ${meta?.total_unidades ?? 0} unidades`;
}

/**
 * Lo mismo que `resumenItems`, pero PARTIDO en sus dos mitades.
 *
 * `resumenItems` devuelve una sola línea —«6 UNIDAD · CREMA COMBINADA X 20 GR»—
 * y sirve donde hay un renglón y nada más: una celda de tabla, un aviso. En una
 * tarjeta esa línea es el problema: el nombre del producto es lo que distingue
 * una de la de al lado, y va detrás de una cuenta que se repite en todas.
 *
 * Se arma desde `meta.items`, la MISMA fuente, y no cortando el texto que
 * devuelve la otra: partir por el « · » se rompería el día que una descripción
 * traiga uno.
 *
 * Devuelve `null` cuando no hay detalle, para que quien la use caiga a
 * `resumenItems` en vez de pintar un hueco.
 */
export function piezasDe(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (items.length === 0) return null;
    if (items.length === 1) {
        const i = items[0];
        return {
            cuenta: `${i.cantidad} ${i.presentacion_tipo ?? ''}`.trim(),
            nombre: i.descripcion ?? String(i.erp_product_id ?? 'Sin nombre'),
        };
    }
    // Con varios no hay UN nombre que mostrar, así que el ancla pasa a ser
    // cuántos productos son, y la cuenta, las unidades que suman.
    const unidades = meta?.total_unidades ?? 0;
    return {
        cuenta: `${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`,
        nombre: `${items.length} productos`,
    };
}

/**
 * Los lotes que el pedido pide, si los trae.
 *
 * Desde el 2026-08-07 quien pide puede elegir de qué lote quiere que salga —y
 * descartar el que vence demasiado pronto— y esa elección MANDA (decisión del
 * usuario). Que quien despacha los vea es la mitad que la hace mandar: un lote
 * elegido que no llega a la pantalla de enfrente es un lote que no se respeta.
 *
 * Los pedidos anteriores no traen `lotes` y devuelven una lista vacía: se ven
 * como siempre, sin un hueco ni un «—» que sugiera que falta algo.
 */
export function lotesPedidos(meta) {
    return (Array.isArray(meta?.items) ? meta.items : [])
        .flatMap(i => (Array.isArray(i.lotes) ? i.lotes : []))
        .filter(l => l && (l.lote || l.vence));
}

/** El texto sobre el que busca la vista: producto, salas, quién y por qué. */
export function textoBuscable(fila, nombrePor) {
    const m = fila?.metadata ?? {};
    const items = Array.isArray(m.items) ? m.items : [];
    return [
        ...items.map(i => i.descripcion ?? ''),
        m.origen_branch_name ?? '',
        m.branch_name ?? '',
        m.rejection_reason ?? '',
        fila?.note ?? '',
        nombrePor?.(fila?.employee_id) ?? '',
    ].join(' ');
}
