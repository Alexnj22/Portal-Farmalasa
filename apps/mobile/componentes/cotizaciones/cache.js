// Las cotizaciones que la lista ya trajo, para que el detalle abra con su
// encabezado sin volver a pedir la lista.
const porId = new Map();
export function guardarCotizaciones(lista) { for (const c of lista || []) porId.set(String(c.id), c); }
export const cotizacionGuardada = (id) => porId.get(String(id)) ?? null;
