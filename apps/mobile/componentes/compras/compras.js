// Las compras que la lista ya trajo, para que el detalle abra con su
// encabezado sin volver a pedirlo.
const porId = new Map();

export function guardarCompras(lista) {
  for (const c of lista || []) porId.set(String(c.id), c);
}

export const compraGuardada = (id) => porId.get(String(id)) ?? null;
