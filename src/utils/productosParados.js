/**
 * Desde cuándo corren los seis meses de un producto parado, y por qué esa
 * fecha. No es siempre la última venta: si el producto entró después a la
 * sala —traslado, pedido, envío, compra— o la empresa lo volvió a comprar tras
 * meses sin tenerlo, el reloj arranca ahí (`productos_parados_de_sala`).
 *
 * Lo usan la pestaña «Stock retenido» y la tarjeta del aviso: escrito una vez,
 * para que las dos digan lo mismo del mismo producto.
 */
export function porQueDesde(row) {
    if (!row?.desde) return 'sin venta ni entrada registrada';
    if (row.desde === row.ultima_venta) return 'última venta';
    if (row.desde === row.ultima_entrada) {
        return {
            traslado: 'llegó por traslado', pedido: 'llegó en pedido',
            envio: 'llegó en un envío', compra: 'se compró',
        }[row.entrada_via] || 'llegó';
    }
    if (row.desde === row.reingreso) return 'reingreso a la empresa';
    return '';
}
