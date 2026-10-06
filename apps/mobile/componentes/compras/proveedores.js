// Los proveedores que la lista ya trajo, para que la ficha abra sin volver a
// pedir el directorio entero. Si la ficha llega sin ellos, los pide ella.
const porId = new Map();

export function guardarProveedores(lista) {
  for (const p of lista || []) porId.set(String(p.id), p);
}

export const proveedorGuardado = (id) => porId.get(String(id)) ?? null;
