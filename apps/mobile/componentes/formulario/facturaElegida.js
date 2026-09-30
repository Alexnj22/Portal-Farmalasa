// La factura que se eligió en la lista viaja a las pantallas siguientes por
// acá (la dirección sólo lleva el id): así el detalle y el formulario no la
// vuelven a pedir, y se muestra la MISMA fila que se tocó.
const elegidas = new Map();
export const guardarFactura = (f, sala) => elegidas.set(String(f.id), { ...f, _sala: sala });
export const facturaElegida = (id) => elegidas.get(String(id)) ?? null;
