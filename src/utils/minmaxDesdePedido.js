// Ajustar el MIN·MAX de un producto desde el pedido (los renglones que no se
// despacharon por la regla o el stock): la validación que pide la base.
//
// Vivía dentro de `ItemSections` (portal). Sale al núcleo para que el teléfono
// rechace lo mismo ANTES de mandarlo: la base lo frena con un CHECK, y un
// «check constraint» crudo no le dice a nadie qué corregir.

/** `null` si vale; si no, el motivo en palabras. */
export function validarMinMax({ min, max }) {
    const nMin = parseInt(min, 10);
    const nMax = parseInt(max, 10);
    if (Number.isNaN(nMin) || nMin < 0) return 'Mín inválido';
    if (Number.isNaN(nMax) || nMax < 0) return 'Máx inválido';
    if (nMin === 0 && nMax > 1) return 'Con Mín 0, el Máx debe ser 0 o 1';
    if (nMin >= 1 && nMax <= nMin) return 'El Máx debe ser mayor que el Mín';
    return null;
}

/** El mensaje cuando la base igual lo rechaza. */
export const mensajeDeMinMax = (e) => (/check constraint/i.test(e?.message ?? '')
    ? 'Valor fuera del rango permitido. Con Mín 0, el Máx es 0 o 1. Con Mín 1 o más, el Máx debe ser mayor.'
    : (e?.message ?? 'No se pudo guardar.'));
