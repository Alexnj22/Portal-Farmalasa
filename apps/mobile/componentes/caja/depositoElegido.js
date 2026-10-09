// El depósito que se acaba de tocar en la lista, para que su detalle abra al
// instante con lo que la lista ya trajo. Si el detalle se abre por un enlace no
// está acá, y la pantalla lo busca.
const elegidos = new Map();

export const recordarDeposito = (d) => { if (d?.id != null) elegidos.set(String(d.id), d); };
export const depositoRecordado = (id) => elegidos.get(String(id)) ?? null;
