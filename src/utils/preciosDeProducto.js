/**
 * Los niveles de precio de un producto y cuáles puede ver cada cargo. Vivían
 * escritos dentro de `views/productos/TabCatalogo.jsx` —el filtro, dos veces—;
 * se mudaron el 2026-10-02 para que la app del teléfono muestre exactamente
 * los mismos niveles al mismo cargo.
 */

/** Los siete niveles, en orden de menor a mayor descuento. */
export const NIVELES_DE_PRECIO = [
    { key: 'vineta', label: 'Víneta' },
    { key: 'descuento_1', label: 'Desc. 1' },
    { key: 'vip', label: 'VIP' },
    { key: 'clinica', label: 'Clínica' },
    { key: 'mayoreo', label: 'Mayoreo' },
    { key: 'premium', label: 'Premium' },
    { key: 'precio_7', label: 'Precio 7' },
];
export const ORDEN_DE_NIVELES = NIVELES_DE_PRECIO.map((n) => n.key);
/** Las columnas de precio, para un `select`. */
export const COLUMNAS_DE_PRECIO = ORDEN_DE_NIVELES.join(', ');

/**
 * Los niveles que ve un cargo: hasta su `maxPriceLevel`, incluido. Sin tope
 * —o con un tope que no es un nivel— ve todos, igual que siempre en el portal.
 */
export function nivelesVisibles(maxPriceLevel) {
    if (!maxPriceLevel) return NIVELES_DE_PRECIO;
    const tope = ORDEN_DE_NIVELES.indexOf(maxPriceLevel);
    if (tope === -1) return NIVELES_DE_PRECIO;
    return NIVELES_DE_PRECIO.filter((n) => ORDEN_DE_NIVELES.indexOf(n.key) <= tope);
}
