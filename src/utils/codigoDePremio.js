// El código de un premio del raspable (2026-10-19): `PS-000123`.
//
// La app lo muestra en barras y en QR SIN el guion (`PS000123`): un lector de
// mostrador conectado como teclado «teclea» lo que lee con la distribución del
// sistema, y en un teclado en español el guion puede llegar como otra tecla
// (`'`, `?`). Así que se acepta con guion, sin él o con lo que el teclado haya
// puesto en su lugar, y se devuelve siempre la forma de la base.

const PATRON = /^\s*PS[^0-9A-Z]?(\d{6})\s*$/i;

/** `PS-000123` si el texto es un código de premio; si no, `null`. */
export function leerCodigoDePremio(texto) {
    const m = PATRON.exec(String(texto ?? ''));
    return m ? `PS-${m[1]}` : null;
}

/** Lo que va dentro de las barras y del QR: sin guion. */
export const codigoParaEscanear = (codigo) => String(codigo ?? '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
