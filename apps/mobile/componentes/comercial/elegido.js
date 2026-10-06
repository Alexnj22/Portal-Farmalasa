// Lo que una pantalla le pasa a la siguiente sin volver a pedirlo: el abono a
// corregir, la promoción, la sucursal… La lista lo deja al tocar y la pantalla
// de destino lo lee. Un objeto no viaja bien por la dirección.
const guardados = new Map();
export const guardar = (clave, valor) => { guardados.set(clave, valor); };
export const leer = (clave) => guardados.get(clave) ?? null;
