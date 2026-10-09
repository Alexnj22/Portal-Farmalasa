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
    if (Number.isNaN(nMin) || nMin < 0) return 'MIN inválido';
    if (Number.isNaN(nMax) || nMax < 0) return 'MAX inválido';
    if (nMin === 0 && nMax > 1) return 'Con MIN=0, MAX debe ser 0 o 1';
    if (nMin >= 1 && nMax <= nMin) return 'MAX debe ser mayor que MIN';
    return null;
}

/** El mensaje cuando la base igual lo rechaza. */
export const mensajeDeMinMax = (e) => (/check constraint/i.test(e?.message ?? '')
    ? 'Valor fuera del rango permitido (MIN=0 → MAX 0–1; MIN≥1 → MAX > MIN).'
    : (e?.message ?? 'No se pudo guardar.'));
