// Los documentos del mes que la lista ya trajo, para que la ficha abra sin
// volver a pedir el mes entero. Si la ficha llega sin ellos (por un enlace),
// los pide ella.
const porId = new Map();

export function guardarDocumentos(lista) {
  for (const d of lista || []) porId.set(String(d.id), d);
}

export const documentoGuardado = (id) => porId.get(String(id)) ?? null;
