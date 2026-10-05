import { formatMoney } from './formatNumber';

/**
 * «−15%» o «$2.00 menos c/u»: lo que el cliente entiende de un descuento de la
 * caja. El monto es por CADA unidad (ver `data/descuentos.js`), y se dice.
 */
export const etiquetaDeDescuento = (tipo, monto) => (tipo === '%'
    ? `−${Number(monto).toLocaleString('es-SV', { maximumFractionDigits: 2 })}%`
    : `${formatMoney(monto)} menos c/u`);

/**
 * Los acentos que puede llevar una oferta en la app: el mismo CHECK de
 * `ofertas_clientes.acento`. `clase` es el color de la muestra en el portal,
 * siempre de un token (nunca un color escrito a mano).
 */
export const ACENTOS_DE_OFERTA = [
    { valor: 'magenta', rotulo: 'Magenta', clase: 'bg-logo-magenta' },
    { valor: 'verde', rotulo: 'Verde', clase: 'bg-logo-green' },
    { valor: 'azul', rotulo: 'Azul', clase: 'bg-brand' },
    { valor: 'naranja', rotulo: 'Naranja', clase: 'bg-warning' },
    { valor: 'rojo', rotulo: 'Rojo', clase: 'bg-danger' },
    { valor: 'violeta', rotulo: 'Violeta', clase: 'bg-brand-purple' },
];
