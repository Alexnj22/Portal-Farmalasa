// Inyecciones que se cuentan por MILILITROS (2026-10-03).
//
// Un vial no trae un número fijo de aplicaciones: depende de cuánto se pone.
// RUBRAVIDA de 10 ml a 2 ml son 5, a 2.5 ml son 4. La regla es la misma que
// aplica la base (`inyeccion_renglones_de_venta` / `inyeccion_cotizar`):
//
//     aplicaciones = unidades vendidas × floor(contenido / dosis)
//
// Escrita acá sólo para que la pantalla muestre el saldo de cada dosis ANTES
// de cobrar; el número que vale lo vuelve a calcular el servidor.

// Margen para la división en coma flotante: 7.5 / 2.5 no siempre da 3 exacto.
const EPS = 1e-9;

/** Aplicaciones que da UNA unidad (un vial) con esa dosis. */
export function aplicacionesPorDosis(contenidoMl, dosisMl) {
    const c = Number(contenidoMl), d = Number(dosisMl);
    if (!(c > 0) || !(d > 0)) return 0;
    return Math.floor(c / d + EPS);
}

/** ¿El renglón se cuenta por ml? */
export const esPorMl = (renglon) => renglon?.contenido_ml != null;

/**
 * El saldo de un renglón con una dosis. Sin ml, el que trae el renglón.
 * Con ml, la dosis ya fijada por un cobro anterior manda sobre la elegida;
 * sin ninguna de las dos, `null` (todavía no se sabe).
 */
export function saldoDelRenglon(renglon, dosisElegida) {
    if (!esPorMl(renglon)) return { total: renglon.total, disponibles: renglon.disponibles, dosis: null };
    const dosis = renglon.dosis_ml != null ? Number(renglon.dosis_ml) : (dosisElegida != null ? Number(dosisElegida) : null);
    if (dosis == null) return null;
    const total = Math.floor(Number(renglon.unidades) * aplicacionesPorDosis(renglon.contenido_ml, dosis) + EPS);
    return { total, disponibles: Math.max(total - Number(renglon.usadas || 0), 0), dosis };
}

/** 2 → «2», 2.5 → «2.5», 2.50 → «2.5». */
export function fmtMl(ml) {
    const n = Number(ml);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n * 100) / 100);
}
