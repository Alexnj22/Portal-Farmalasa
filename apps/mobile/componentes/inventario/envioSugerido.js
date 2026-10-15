// El envío sugerido de Gestión de stock → «Sin venta», de una pantalla a la
// otra. Lo que se pasa (los productos, las filas con su Min/Max, la sala) no
// cabe con gusto en los parámetros de la ruta, así que queda acá en memoria y
// `enviar-producto` lo lee al abrirse con `?sugerido=1` y lo OLVIDA enseguida
// (en un efecto, no al renderizar), para que volver a abrir el formulario a
// mano no reviva una sugerencia vieja.
//
// Forma: { origenErp, destino, motivo, nota, productos, filas, alTerminar }.
// `alTerminar` lo llama el formulario cuando el envío salió, para que la lista
// de «Sin venta» se recargue.
let pendiente = null;

export function dejarEnvioSugerido(envio) { pendiente = envio; }
export function verEnvioSugerido() { return pendiente; }
export function olvidarEnvioSugerido() { pendiente = null; }
