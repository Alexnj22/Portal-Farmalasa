import { formatMoney } from './formatNumber';

/**
 * «−15%» o «$2.00 menos c/u»: lo que el cliente entiende de un descuento de la
 * caja. El monto es por CADA unidad (ver `data/descuentos.js`), y se dice.
 */
export const etiquetaDeDescuento = (tipo, monto) => (tipo === '%'
    ? `−${Number(monto).toLocaleString('es-SV', { maximumFractionDigits: 2 })}%`
    : `${formatMoney(monto)} menos c/u`);
