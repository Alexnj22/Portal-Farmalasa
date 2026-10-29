/**
 * El icono de la farmacia en el ticket — sólo el círculo con la cruz, sin el
 * nombre (usuario, 2026-10-29: «agrega el logo. pero solo el icono»).
 *
 * Va en blanco y negro porque el papel térmico no tiene grises: los anillos
 * verde y morado del logo salen en negro. Sale de `public/Logo512.png`
 * reducido a 128 × 128 puntos (~16 mm en una ticketera de 203 ppp); el mismo
 * dibujo vive en `public/logo-ticket.png` para el envío directo.
 *
 * Un dibujo, tres caminos, porque cada camino lo pide distinto:
 *   · directo (programa de la caja) → por URL, como manda el suyo el sistema
 *     de facturación: el programa lo descarga y lo dibuja.
 *   · cola de la sala → los bits mismos, con `GS v 0` (ver `logoParaElRollo`).
 *   · diálogo del navegador → la imagen embebida en el HTML.
 */

export const LOGO_TICKET_URL = 'https://portal.farmasalud.lat/logo-ticket.png';

export const LOGO_TICKET_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACAAQAAAADrRVxmAAACYElEQVR42pWVzW3bQBCFvx0SEA9CxA7MSiKWkhLSgQmkkZSQEugOUgID5JAjDzkwBs2Xw+ySq7UhJ7rpcebNm52/IG5/xj8CP0JIiCRpBS6SJDkw7Z8iAMD1AFYATpIkA/gJwPMR5avTD3uUGPAhcawROCWO3xFYE8ccgS0BUxI9RNI9satzCLhoTaYexPM5edjFM92gcpcFPgNh8DDSRJAkzeAWEx8AOMMABiMtAFV6Qnj0xxq5SmiLFNLEgwNVBBYukrFxjsprFjDWyBlZDehScsMKaI4FkTQGyZj3ItK5y1HvVmBM9Q40btHsQM2AMbY3vWFZVAIjxpC1j6ffA0/eQf2EKZkMiSdkLt1cdGELtlnZlnX2r1kKlxpsbe61tq0Y7T2LALZ0d8djwOhzYLs3UQNAD7Ok0aFH6cmnYcxd5jln6Cbb+zhZhFdRbnOZCx3tG8LsFce3Amj/c100y3sW9opjNJbCpvnPsPVgrIVFXfroi49bHLxLURdhfKRoS8ra6n1hefev7RsWXV7q5U2OvNpzV9R2wo5Ft7vkbzj2RlP2aflCWsK+HbQho1aebCFsDdjNbC9uMeYtZ4RM++TvcUgda4xcatwOuzLRYMDLIaP1DTNkm96g3eP+ovMt9X2P2oO0xFMjgWRQx1ODCHH1xVPzzH4bHuIKrvzgDJEETn5wev7g+pp943Z+y1rnmCH4Ebk6xwJUihGCQOlhQ3zkUOzTo4fO6RJO2Sm0uBMB+AQEAS91yi5yVMVtSKU6H0d8TjvIhUVpYTtcwgjxlrkFLzVxCmIa1cyV3OLOePwFmPlwER5AXQ0AAAAASUVORK5CYII=';

const LADO = 128;   // puntos; múltiplo de 8
const FILAS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH///AAAAAAAAAAAAAAAAA/////AAAAAAAAAAAAAAAB//////AAAAAAAAAAAAAAD//////8AAAAAAAAAAAAAD///////4AAAAAAAAAAAAH////////gAAAAAAAAAAAH////////+AAAAAAAAAAAD/////////4AAAAAAAAAAD//////////gAAAAAAAAAD//////////8AAAAAAAAAB///////////gAAAAAAAAA///////////+AAAAAAAAA////////////wAAAAAAAAf////AAA////+AAAAAAAAP///8AAAAf///4AAAAAAAH///wAAAAAf///AAAAAAAD///gAAAAAB///4AAAAAAB///gAAAAAAD///AAAAAAA///AAAAAAAAP//4AAAAAAf//gAAAAAAAA//+AAAAAAP//gAAAAAAAAD//wAAAAAH//gAAAAAAAAAf/+AAAAAB//wAAAAAAAAAB//wAAAAA//wAAAAAAAAAAP/+AAAAAf/4AAAAAAAAAAA//gAAAAH/8AAAAAAAAAAAH/8AAAAD/8AAAAAAAAAAAA//gAAAB/+AAAAAAAAAAAAH/4AAAAf/AAAAAAAAAAAAA//AAAAP/gAAAAAAAAAAAAH/wAAAD/wAAAAAAAAAAAAA/+AAAB/4AAAAAAAAAAAAAH/gAAAf8AAAAAAAAAAAAAA/8AAAP/AAAAAAAAAAAAAAH/AAAD/gAAAAD///wAAAAA/4AAB/wAAAAA///+AAAAAP+AAAf4AAAAAP///gAAAAB/wAAH+AAAAAD///4AAAAAP8AAD/AAAAAA///+AAAAAD/AAA/gAAAAAP///gAAAAAf4AAP4AAAAAD///4AAAAAD+AAH8AAAAAA///+AAAAAA/gAB/AAAAAAP///gAAAAAH8AAfgAAAAAD///4AAAAAB/AAH4AAAAAA///+AAAAAAPwAD8AAAAAAP///gAAAAAD8AA/AAAAAAD///4AAAAAAfAAPgAAAAAA///+AAAAAAH4AD4AAAAAAP///gAAAAAB+AA+AAAAAAD///wAAAAAAPgAPAAAAP////////4AAAD4ADwAAAH////////+AAAA+AB8QAAB/////////gAAAHiAfMAAAf////////4AAAB4gHjAAAH////////+AAAAeIB4gAAB/////////gAAAHjAeIAAAf////////4AAAA4wHiAAAH////////+AAAAOMBwgAAB/////////gAAADjAccAAAf////////4AAAA4wDHAAAH////////+AAAAOMAxwAAB/////////gAAADjAMcAAAf////////4AAAAY4DHAAAH////////+AAAAGOAxwAAB/////////gAAABDgMcAAAf////////4AAAAR4DHgAAH////////+AAAAEeAR4AAB/////////gAAABHgEeAAAf////////4AAAAR4BHgAAH////////+AAAAA+AR8AAB/////////gAAAAPgAfAAAf////////4AAAAD4AHwAAAAAP///gAAAAAAA8AB8AAAAAD///wAAAAAAAfAAPgAAAAA///+AAAAAAAHwAD4AAAAAP///gAAAAAAD8AA/AAAAAD///4AAAAAAA/AAPwAAAAA///+AAAAAAAPwAD+AAAAAP///gAAAAAAH4AA/gAAAAD///4AAAAAAB+AAH8AAAAA///+AAAAAAA/gAB/AAAAAP///gAAAAAAP4AAf4AAAAD///4AAAAAAH8AAD+AAAAA///+AAAAAAD/AAA/wAAAAP///gAAAAAA/wAAP+AAAAD///4AAAAAAf4AAB/gAAAA///+AAAAAAP+AAAf8AAAAP///gAAAAAD/gAAH/gAAAAAAAAAAAAAB/wAAA/8AAAAAAAAAAAAAA/8AAAP/AAAAAAAAAAAAAAf+AAAB/4AAAAAAAAAAAAAP/gAAAf/AAAAAAAAAAAAAH/wAAAD/4AAAAAAAAAAAAD/8AAAAf/AAAAAAAAAAAAB/+AAAAH/4AAAAAAAAAAAA//gAAAA//AAAAAAAAAAAAf/wAAAAP/8AAAAAAAAAAAP/4AAAAB//gAAAAAAAAAAH/+AAAAAP/8AAAAAAAAAAH//AAAAAB//wAAAAAAAAAD//gAAAAAf/+AAAAAAAAAD//wAAAAAD//4AAAAAAAAB//4AAAAAAf//gAAAAAAAB//+AAAAAAD//+AAAAAAAB///AAAAAAAf//4AAAAAAD///gAAAAAAD///wAAAAAD///wAAAAAAAf///gAAAAH///4AAAAAAAD////gAAA////8AAAAAAAAf////8AP////8AAAAAAAAB///////////+AAAAAAAAAP///////////AAAAAAAAAB///////////AAAAAAAAAAH//////////gAAAAAAAAAA//////////gAAAAAAAAAAD/////////wAAAAAAAAAAAP////////wAAAAAAAAAAAA////////wAAAAAAAAAAAAD///////gAAAAAAAAAAAAAH//////gAAAAAAAAAAAAAAP/////AAAAAAAAAAAAAAAAP///8AAAAAAAAAAAAAAAAAD//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Puntos imprimibles por ancho de rollo (cabezal de 203 ppp). */
const PUNTOS_POR_ANCHO = { 80: 576, 76: 512, 58: 384 };

let filasCache = null;
function filas() {
    if (!filasCache) {
        const bin = atob(FILAS);
        filasCache = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) filasCache[i] = bin.charCodeAt(i);
    }
    return filasCache;
}

/**
 * El icono como imagen de puntos ESC/POS (`GS v 0`), centrado.
 *
 * **Centrado con relleno, no con `ESC a`**: en esa impresora los códigos de
 * alineación no mandan (ver ticketPrint.js), así que la imagen se arma del
 * ancho entero del rollo con bytes en blanco a los costados. Los bytes van
 * como caracteres de 0 a 255, igual que el resto del ticket: `ticketEnBase64`
 * los toma con `charCodeAt & 0xFF`.
 */
export function logoParaElRollo(anchoMm = 80) {
    const puntos = PUNTOS_POR_ANCHO[anchoMm] ?? PUNTOS_POR_ANCHO[80];
    const anchoBytes = puntos / 8, ladoBytes = LADO / 8;
    const izq = Math.floor((anchoBytes - ladoBytes) / 2);
    const datos = filas();
    let s = '\x1dv0\x00' + String.fromCharCode(anchoBytes & 0xFF, anchoBytes >> 8, LADO & 0xFF, LADO >> 8);
    for (let y = 0; y < LADO; y++) {
        let fila = '\x00'.repeat(izq);
        for (let x = 0; x < ladoBytes; x++) fila += String.fromCharCode(datos[y * ladoBytes + x]);
        s += fila + '\x00'.repeat(anchoBytes - izq - ladoBytes);
    }
    return s + '\n';
}
