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

export const fmtFechaLarga = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' });
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
