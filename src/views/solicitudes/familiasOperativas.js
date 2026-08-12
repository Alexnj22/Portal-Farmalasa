import { PackageMinus, Receipt, TrendingUp } from 'lucide-react';

/**
 * Las tres familias de solicitud que habla de la SALA y que se pueden abrir
 * desde «Nueva solicitud» — las mismas tres baldosas del tablero.
 *
 * Viven en su propio archivo y no dentro del modal porque la vista necesita
 * saber CUÁNTAS hay disponibles antes de decidir si dibuja el botón, y un
 * módulo que exporta un componente y además una función suelta rompe el
 * refresco en caliente (regla `react-refresh/only-export-components`).
 *
 * El **traslado entre salas** no está, y no es olvido: su formulario arranca
 * con un producto ya elegido —se pide desde la existencia de otra sala, en la
 * consulta de inventario— y sin ese producto no tiene primera pantalla.
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
