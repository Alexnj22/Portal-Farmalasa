// Los campos de texto que comparten todos los documentos que van al rollo.
//
// Vivían dentro de `corteComprobante.js`, que era el único que imprimía. Con el
// segundo documento —las bolsas de efectivo— copiarlos habría sido tener dos
// definiciones de qué es «sólo ASCII» y dos de cómo se recorta un nombre: dos
// reglas que se rompen la misma noche y en el papel, donde nadie las mira.
//
// Las reglas del rollo y por qué existen, en la §5 de
// `docs/IMPRESION-EN-TICKETERA-2026-08-13.md`.

/** El ancho útil del rollo en letra chica. Ver COLUMNAS_TICKET en ticketPrint. */
export const COLUMNAS = 54;

/**
 * Sin tildes ni eñes: el rollo es ASCII.
 *
 * Se hace acá además de en el envío directo porque los nombres vienen de la
 * base y nadie los escribió pensando en papel térmico — «NUÑEZ» salió `NUÆEZ` la
 * primera vez que se imprimió de verdad.
 */
export const soloAscii = (s) => String(s ?? '')
    // La eñe ANTES de descomponer: `NFD` la parte en `n` + tilde y el barrido de
    // diacríticos la dejaría en `n` igual, pero así el paso es explícito y no
    // depende del orden de dos reglas que parecen independientes.
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');

/**
 * Recorta a lo ancho del papel, acá y no en la impresora — que parte donde se le
 * acaba el rollo, a mitad de palabra.
 */
export const recortar = (s, max) => {
    const t = soloAscii(s).trim();
    return t.length > max ? `${t.slice(0, max - 1)}.` : t;
};

/** dd/mm/aaaa de una fecha `YYYY-MM-DD`, sin que el huso la corra un día. */
export const fechaCorta = (fecha) => {
    if (!fecha) return '';
    const [a, m, d] = String(fecha).split('-');
    return `${d}/${m}/${a}`;
};

/** La hora del corte, sin segundos: `19:01:41` → `19:01`. */
export const hhmm = (hora) => String(hora || '').slice(0, 5);

/** Cuándo se firmó, en hora de la sala. */
export const selloDeTiempo = (iso) => (iso
    ? soloAscii(new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'America/El_Salvador',
    }))
    : '');

/**
 * El mismo sello, en el ancho de media columna: `14/08/26 07:12 pm`.
 *
 * `selloDeTiempo` mide 23 caracteres —`14/08/2026, 07:12 p. m.`— y media columna
 * del rollo son 27: con el rótulo delante no entra ni uno, así que un ticket
 * lleno de sellos largos no puede armar dos columnas y sale al doble de largo.
 * Lo que se suelta son dos dígitos del año, la coma y dos puntos de `p. m.`:
 * nada que alguien lea distinto sobre el mostrador.
 */
export const selloCorto = (iso) => (iso
    ? soloAscii(new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'America/El_Salvador',
    }))
        .replace(',', '')
        .replace(/([ap])\.\s*m\.?/i, '$1m')
    : '');

/**
 * Dos textos en un renglón si entran, y en dos si no.
 *
 * Existe para juntar lo que se leía en dos renglones sin motivo —«Registro:
 * Ana Pena» y su sello de tiempo— sin apostar a que siempre quepan: un nombre
 * de 40 caracteres desborda las 54 columnas y la impresora lo parte donde se le
 * acaba el papel, a mitad de palabra. Devuelve un arreglo para poder esparcirlo
 * dentro del pie sin un `if` en cada uso.
 */
export const juntarSiEntra = (a, b, { ancho = COLUMNAS, union = ' - ' } = {}) => {
    if (!a) return b ? [b] : [];
    if (!b) return [a];
    const junto = `${a}${union}${b}`;
    return junto.length <= ancho ? [junto] : [a, b];
};
