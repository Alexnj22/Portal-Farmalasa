import { hora12Papel } from './hora';
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

/**
 * La hora de una COLUMNA del rollo: `19:01:41` → `7:01pm`. En 12 horas como
 * todo el portal, pero sin los puntos ni el espacio de `p.m.`: las columnas de
 * importes miden 8 y `aDerecha` corta por la IZQUIERDA, así que «12:05 p.m.»
 * (10) saldría « p.m.» — sin la hora. `12:05pm` son 7 y entra siempre.
 */
export const horaDeColumna = (hora) => hora12Papel(hora).replace(/ ([ap])\.m\.$/, '$1m');

/** Cuándo se firmó, en hora de la sala. */
export const selloDeTiempo = (iso) => (iso
    ? soloAscii(`${new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        timeZone: 'America/El_Salvador',
    })}, ${hora12Papel(iso)}`)
    : '');

/**
 * El mismo sello, en el ancho de media columna: `14/08/26 7:12 p.m.`.
 *
 * `selloDeTiempo` mide 21 caracteres —`14/08/2026, 7:12 p.m.`— y media columna
 * del rollo son 27: con el rótulo delante no entra ni uno, así que un ticket
 * lleno de sellos largos no puede armar dos columnas y sale al doble de largo.
 * Lo que se suelta son dos dígitos del año y la coma: nada que alguien lea
 * distinto sobre el mostrador.
 */
export const selloCorto = (iso) => (iso
    ? soloAscii(`${new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        timeZone: 'America/El_Salvador',
    })} ${hora12Papel(iso)}`)
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
