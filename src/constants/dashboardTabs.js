// Qué widget del tablero vive en qué pestaña, y cuándo una pestaña se muestra.
//
// Vive acá y no dentro de `DashboardView` porque lo necesitan DOS pantallas: el
// tablero, para armar cada pestaña y decidir cuáles salen, y **Permisos**, para
// agrupar los widgets por pestaña en vez de listar veinticuatro seguidos. Dos
// listas a mano que dicen lo mismo se desincronizan siempre; ésta es una sola.

// Las tres pestañas temáticas. `general` NO se declara: es todo el catálogo.
//
// `kpi` aparece en dos a propósito — no es un widget de la rejilla, se pinta
// aparte arriba de todo—, y por eso `tematicaDe` lo trata como si no tuviera
// pestaña propia: no puede "pertenecer" a una sola.
export const PESTANAS_TEMATICAS = {
    comercial: ['kpi', 'meta_sala', 'cotizaciones', 'facturacion', 'top_productos', 'sales', 'vendedores'],
    rrhh:      ['kpi', 'trend', 'shifts', 'absences', 'requests', 'calendar', 'announcements', 'birthdays'],
    operacion: ['inv_search', 'annulment_req', 'minmax_req', 'inv_movement', 'traslados', 'facturas_sala'],
};

/** Los widgets de una pestaña. General es el resumen: todo el catálogo. */
export function catalogoDePestana(tabId, todosLosIds = []) {
    if (tabId !== 'general') return PESTANAS_TEMATICAS[tabId] || [];
    return todosLosIds;
}

/**
 * La pestaña temática a la que PERTENECE un widget, o `null` si no tiene una
 * propia. Sirve para agrupar en Permisos, donde cada widget tiene que aparecer
 * una sola vez: dos interruptores del mismo permiso no se pueden leer.
 */
export function tematicaDe(id) {
    const dueñas = Object.entries(PESTANAS_TEMATICAS)
        .filter(([, ids]) => ids.includes(id))
        .map(([tab]) => tab);
    return dueñas.length === 1 ? dueñas[0] : null;
}

/**
 * Qué pestañas mostrarle a un cargo. Reportado el 2026-08-07: «si un rol no
 * tiene widgets activados de una categoría, la pestaña no debe salir».
 *
 * Las temáticas es directo: sin un widget visible de su lista, no salen.
 *
 * General necesita su propia regla, porque muestra TODO y entonces nunca estaría
 * vacía. Se oculta cuando **sería un duplicado**: si todo lo que el cargo ve cae
 * en una sola pestaña temática, General y esa pestaña dicen exactamente lo
 * mismo. Con widgets de dos categorías —o con alguno que no tenga pestaña
 * propia, como Alertas de sucursales— General vuelve a ser el único lugar donde
 * se ven juntos, y sale.
 *
 * @param todosLosIds catálogo completo de widgets de la rejilla (sin `kpi`)
 * @param esVisible   (id) => boolean — permiso del cargo y «Personalizar»
 */
export function pestanasVisibles(todosLosIds, esVisible) {
    const visibles = todosLosIds.filter(id => id !== 'kpi' && esVisible(id));
    if (!visibles.length) return [];

    const conTematica = new Set(visibles.map(tematicaDe).filter(Boolean));
    const haySueltos  = visibles.some(id => tematicaDe(id) === null);
    const generalDuplica = !haySueltos && conTematica.size === 1;

    return [
        ...(generalDuplica ? [] : ['general']),
        ...['comercial', 'rrhh', 'operacion'].filter(tab =>
            visibles.some(id => (PESTANAS_TEMATICAS[tab] || []).includes(id))),
    ];
}
