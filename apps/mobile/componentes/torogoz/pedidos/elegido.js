// El pedido que se acaba de tocar en la lista, para que su detalle abra al
// instante con lo que la lista ya trajo. Si el detalle se abre por un enlace
// (sin pasar por la lista) no está acá, y la pantalla lo busca.
const elegidos = new Map();

export const recordarPedido = (p) => { if (p?.id != null) elegidos.set(String(p.id), p); };
export const pedidoRecordado = (id) => elegidos.get(String(id)) ?? null;

// El cliente que se acaba de dar de alta DESDE LA VENTA («Cliente nuevo» en la
// hoja de elegir cliente): la ficha lo deja acá al guardar y vuelve; la venta
// lo recoge al volver al frente, relee la lista y lo deja elegido — como el
// `alCrearCliente` del portal. Se lee una sola vez.
let clienteNuevoDeLaVenta = null;
export const dejarClienteNuevo = (id) => { clienteNuevoDeLaVenta = id == null ? null : String(id); };
export const tomarClienteNuevo = () => { const id = clienteNuevoDeLaVenta; clienteNuevoDeLaVenta = null; return id; };
