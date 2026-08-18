import { ArrowLeftRight, PackageMinus, Receipt, TrendingUp } from 'lucide-react';

/**
 * Las CUATRO familias de solicitud que hablan de la SALA y que se pueden abrir
 * desde «Nueva solicitud» — las mismas baldosas del tablero.
 *
 * Viven en su propio archivo y no dentro del modal porque la vista necesita
 * saber CUÁNTAS hay disponibles antes de decidir si dibuja el botón, y un
 * módulo que exporta un componente y además una función suelta rompe el
 * refresco en caliente (regla `react-refresh/only-export-components`).
 *
 * ── «Pedir a otra sala» abre la CONSULTA DE INVENTARIO (2026-08-18) ────────
 * Y no una pantalla propia, que es lo que hacía entre el 15 y el 18 de agosto.
 * Aquélla arrancaba por un buscador de catálogo y detrás no tenía lotes, así
 * que la solicitud viajaba sin decir de qué lote tenía que salir el producto y
 * quien despacha lo elegía por su cuenta — la elección del lote es de quien
 * pide («los lotes MANDAN», decisión del usuario 2026-08-07). Costó el
 * ALOPURINOL del 18-ago.
 *
 * Hoy esta baldosa monta `FormularioPedirASala`, el MISMO cuerpo que la
 * consulta de inventario del tablero: se busca el producto, se ve qué salas lo
 * tienen y con qué lotes, y se pide desde ahí. Dos puertas, una sola pantalla,
 * un solo dato. Decisión del usuario, 2026-08-18.
 */
export const FAMILIAS = [
    {
        key: 'inventario', icon: PackageMinus,
        label: 'Ajuste de inventario',
        desc: 'Cargar o descargar producto de la sala',
        permiso: 'dash_inv_movement',
        color: 'text-danger-text', bg: 'bg-danger/5 border-danger/20 hover:border-danger/40',
        iconBg: 'bg-danger/10',
    },
    {
        key: 'facturacion', icon: Receipt,
        label: 'Modificar facturación',
        desc: 'Anular una factura, o cambiar su cliente, vendedor o forma de pago',
        permiso: 'dash_annulment_req',
        color: 'text-warning-text', bg: 'bg-warning/5 border-warning/20 hover:border-warning/40',
        iconBg: 'bg-warning/10',
    },
    {
        key: 'minmax', icon: TrendingUp,
        label: 'Ajuste de Min/Max',
        desc: 'Proponer un mínimo o un máximo distinto para un producto',
        permiso: 'dash_minmax_req',
        color: 'text-brand-text', bg: 'bg-brand/5 border-brand/20 hover:border-brand/40',
        iconBg: 'bg-brand/10',
    },
    {
        key: 'traslado', icon: ArrowLeftRight,
        label: 'Pedir a otra sala',
        // Sin la palabra «traslado» a propósito: quien lo pide está pensando en
        // que le falta un producto, no en el nombre del movimiento. El módulo
        // sigue llamándose Traslados donde se administra.
        //
        // Y la descripción anuncia el BUSCADOR, que es la primera pantalla que
        // aparece: decir sólo «pedile a otra sala» y abrir una búsqueda se lee
        // como que se abrió lo que no era.
        desc: 'Buscar el producto y ver qué salas lo tienen',
        // La misma llave que la consulta de inventario, que es la pantalla que
        // esto abre. Es la MISMA capacidad —«puede pedirle producto a otra
        // sala»— y una llave nueva sería un segundo interruptor para una puerta
        // que ya tiene el suyo.
        permiso: 'dash_inv_search',
        // `chart-3` y no el `warning` de la baldosa del tablero: acá conviven
        // las cuatro en una lista y la facturación ya es la amarilla. Dos
        // baldosas del mismo color en el mismo menú dejan de distinguirse.
        color: 'text-chart-3-text', bg: 'bg-chart-3/5 border-chart-3/20 hover:border-chart-3/40',
        iconBg: 'bg-chart-3/10',
    },
];

/**
 * Cuáles puede abrir esta persona.
 *
 * Se pregunta por la MISMA llave que gobierna la baldosa del tablero, y no por
 * una nueva: es la misma capacidad —«puede pedir un ajuste de inventario»— y
 * dos interruptores para una puerta es justo lo que se acaba de terminar con
 * «Mis Solicitudes». Que la llave se llame `dash_*` es herencia de haber
 * nacido en el tablero, no una decisión de acá.
 */
export const familiasDisponibles = (hasPermission) =>
    FAMILIAS.filter(f => hasPermission(f.permiso, 'can_view'));
