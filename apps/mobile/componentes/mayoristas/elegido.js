// El cliente que se tocó en la lista de Clientes Mayoristas, para que su ficha
// abra al instante con los números de la lista (promedio, a mayoreo, margen…)
// sin volver a pedirlos. Si la ficha se abre directo (un enlace, la app
// relanzada), la ficha relee la lista y lo busca.
const elegidos = new Map();

export const recordarMayorista = (fila) => { if (fila?.customer_id != null) elegidos.set(String(fila.customer_id), fila); };
export const mayoristaRecordado = (id) => elegidos.get(String(id)) ?? null;
