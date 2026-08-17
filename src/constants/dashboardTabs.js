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
    comercial: ['kpi', 'meta_sala', 'cortes_sala', 'cotizaciones', 'facturacion', 'top_productos', 'sales', 'vendedores'],
    rrhh:      ['kpi', 'trend', 'shifts', 'absences', 'requests', 'calendar', 'announcements', 'birthdays'],
    operacion: ['inv_search', 'annulment_req', 'minmax_req', 'inv_movement', 'traslados', 'facturas_sala', 'bitacoras'],
};

/** Los widgets de una pestaña. General es el resumen: todo el catálogo. */
export function catalogoDePestana(tabId, todosLosIds = []) {
    if (tabId !== 'general') return PESTANAS_TEMATICAS[tabId] || [];
    return todosLosIds;
}

/**
 * ¿Esta pestaña hospeda las baldosas por sucursal?
 *
 * Las `sales_branch_*` son ids **dinámicos** —una por sucursal con ventas— así
 * que no pueden estar en las listas de arriba, que son fijas. Y hasta el
 * 2026-08-16 sólo aparecían en General, porque el único sitio donde se
 * colocaban era el acomodo de esa pestaña. Reportado por el usuario: «porque
 * los de ventas por sucursal no salen? ni en comercial?».
 *
 * La regla es la del widget del que dependen: van donde va «Ventas por
 * día/hora» (`sales`), que es el que además les presta el permiso
 * (`dash_sales`). Hoy eso da General y Comercial, y el día que `sales` entre a
 * otra categoría, las baldosas la siguen sin que nadie tenga que acordarse.
 */
export function hospedaBaldosasDeSucursal(tabId) {
    return tabId === 'general' || (PESTANAS_TEMATICAS[tabId] || []).includes('sales');
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
 * **General sale siempre** (mientras el cargo vea al menos un widget). Tuvo una
 * regla propia que la escondía cuando «sería un duplicado» —si todo lo que el
 * cargo ve cae en una sola temática, las dos pestañas dicen lo mismo—, y era
 * correcta mientras las cuatro se comportaban igual. Dejó de serlo el
 * 2026-08-07, cuando las temáticas pasaron a mostrar el acomodo publicado por el
 * SU: desde entonces General no es una vista repetida sino **la única superficie
 * que cada quien puede acomodar**, y esconderla le quita esa libertad justo a
 * los cargos más acotados, que son los que la tendrían más a mano. Un tablero
 * repetido se ignora; uno que no se puede tocar, no.
 *
 * @param todosLosIds catálogo completo de widgets de la rejilla (sin `kpi`)
 * @param esVisible   (id) => boolean — permiso del cargo y «Personalizar»
 */
export function pestanasVisibles(todosLosIds, esVisible) {
    const visibles = todosLosIds.filter(id => id !== 'kpi' && esVisible(id));
    if (!visibles.length) return [];

    return [
        'general',
        ...['comercial', 'rrhh', 'operacion'].filter(tab =>
            visibles.some(id => (PESTANAS_TEMATICAS[tab] || []).includes(id))),
    ];
}

/**
 * El orden en que se pinta una pestaña temática para un cargo.
 *
 * **Devuelve un ORDEN, no coordenadas** — y ahí está todo el diseño. El canon
 * que publica el SU guarda la lista ordenada; las columnas y filas las calcula
 * `autoPlaceOrder` al pintar, sobre los widgets que este cargo puede ver. Por
 * eso «se adapta»: al cargo que no tiene el segundo widget no le queda el hueco
 * donde estaba, porque nunca hubo un hueco guardado. Y por eso la misma lista
 * sirve para 4 columnas y para 2 sin un canon aparte por formato.
 *
 * También es lo que cierra la clase de bug del encimado. Las coordenadas por
 * usuario eran la foto de un catálogo que seguía cambiando, y cada widget nuevo
 * obligaba a mezclar las dos — cinco correcciones entre v2.483.2 y v2.508.1,
 * todas la misma causa. Acá no hay nada por usuario que mezclar.
 *
 * @param tabId       pestaña temática
 * @param canonOrden  `orden` publicado, o vacío si el SU todavía no publicó
 * @param esVisible   (id) => boolean — permiso del cargo
 */
export function ordenDeLaPestana(tabId, canonOrden, esVisible, dinamicos = []) {
    const catalogo = (PESTANAS_TEMATICAS[tabId] || []).filter(id => id !== 'kpi');
    // Del canon sobrevive lo que sigue existiendo: un widget retirado se cae
    // solo, sin necesidad de limpiar la fila publicada.
    const publicados = (canonOrden || []).filter(id => catalogo.includes(id));
    // Lo que el canon no conoce va al final, en el orden en que está declarada
    // la categoría. Es el caso de un widget agregado después de publicar: sale
    // igual, en un lugar razonable, y al SU se le avisa que quedó sin ubicar.
    const sinUbicar = catalogo.filter(id => !publicados.includes(id));
    // Las baldosas por sucursal van al final y **nunca al canon**: el canon es
    // una lista publicada para todos los cargos, y qué sucursales tienen ventas
    // cambia solo. Guardarlas ahí sería congelar un dato vivo — es el mismo
    // motivo por el que esta función devuelve un ORDEN y no coordenadas.
    return [...publicados, ...sinUbicar, ...dinamicos].filter(esVisible);
}

/**
 * Los widgets de la categoría que el canon publicado no menciona. Solo para
 * avisarle al SU; con el canon vacío no hay nada «sin ubicar», hay un orden por
 * defecto, que es distinto y no merece una alerta.
 */
export function widgetsSinUbicar(tabId, canonOrden) {
    if (!canonOrden?.length) return [];
    const catalogo = (PESTANAS_TEMATICAS[tabId] || []).filter(id => id !== 'kpi');
    return catalogo.filter(id => !canonOrden.includes(id));
}
