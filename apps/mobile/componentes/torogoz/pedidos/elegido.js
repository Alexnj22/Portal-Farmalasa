// El pedido que se acaba de tocar en la lista, para que su detalle abra al
// instante con lo que la lista ya trajo. Si el detalle se abre por un enlace
// (sin pasar por la lista) no está acá, y la pantalla lo busca.
const elegidos = new Map();

export const recordarPedido = (p) => { if (p?.id != null) elegidos.set(String(p.id), p); };
export const pedidoRecordado = (id) => elegidos.get(String(id)) ?? null;
