// Ajustes de las aplicaciones de inyección — lo que decide la pestaña Ajustes,
// escrito UNA vez para el portal (`TabAjustes`, `MililitrosModal`) y la app.

/* Cómo se vende el producto, para que quien confirma sepa qué es «la unidad
 * suelta»: [1, 5] → «suelta y en caja de 5». Si sólo se vende entero, la
 * unidad es el paquete (un TRI PACK, «X 3 AMPOLLAS»). */
export function comoSeVende(factores) {
    const cajas = (factores || []).filter((f) => f > 1);
    if (!cajas.length) return 'Se vende sólo entero';
    return `Se vende suelta y en caja de ${cajas.join(' o ')}`;
}

// Contar por ml también es una confirmación: alguien dijo cuánto trae.
export const sinDecidirDosis = (f) => f.confirmadas == null && f.contenido_ml == null;

/** El catálogo partido: lo que cuenta como inyección y lo quitado a mano. */
export function partirCatalogoDeDosis(filas) {
    const activas = (filas || []).filter((f) => f.clasificacion !== 'quitado');
    const quitados = (filas || []).filter((f) => f.clasificacion === 'quitado');
    return { activas, quitados, sinConfirmar: activas.filter(sinDecidirDosis).length };
}

/* «Quitar» un producto que se agregó a mano lo devuelve a lo automático (que
 * no lo cuenta); quitar uno que cuenta por su nombre lo marca como «no es
 * inyección». */
export const valorAlQuitar = (f) => (f.clasificacion === 'incluido' ? null : false);

export const APLICACIONES_MIN = 1;
export const APLICACIONES_MAX = 20;

// Cuatro casillas fijas y no una lista libre separada por comas: en español
// «2,5» es un número, y una coma que separa y otra que es decimal no se pueden
// distinguir.
export const CASILLAS_DE_DOSIS = 4;
export const numeroDeMl = (t) => {
    const n = Number(String(t ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Lo escrito en el formulario de mililitros, leído: contenido, dosis válidas y si se puede guardar. */
export function leerMililitros(contenido, dosis) {
    const c = numeroDeMl(contenido);
    const lista = [...new Set((dosis || []).map(numeroDeMl).filter((d) => d != null))].sort((a, b) => a - b);
    const pasadas = c != null && lista.some((d) => d > c);
    return { c, lista, pasadas, valido: c != null && c <= 500 && lista.length > 0 && !pasadas };
}

/** Los precios que cambiaron respecto de los guardados (`COMPRADA`, `TRAIDA`). */
export function preciosCambiados(precios, borrador) {
    if (!precios) return [];
    return ['COMPRADA', 'TRAIDA'].filter((o) => Number(borrador[o]) !== precios[o]);
}
