// ═══════════════════════════════════════════════════════════════════════════
// Imprimir el mes de bitácoras.
//
// El PAPEL vive en `bitacoraPapel.js` —sin un solo import, para que se pueda
// dibujar con node sin levantar el portal— y acá queda sólo el puente con la
// ventana. Ver la cabecera de ese archivo para el porqué del formato.
// ═══════════════════════════════════════════════════════════════════════════

import { armarHtmlDelMes } from './bitacoraPapel';
import { escribirEImprimir } from './ventanaDeImpresion';

export { armarHtmlDelMes, hojasDelMes } from './bitacoraPapel';

/**
 * Arma el documento entero y lo escribe en la ventana YA ABIERTA.
 *
 * Recibe la ventana hecha —no la abre— porque quien llama tiene que abrirla
 * sincrónica dentro del clic, antes de ir a buscar el mes: después de un
 * `await` el bloqueador de emergentes la mata. Ver `ventanaDeImpresion.js`.
 *
 * @param {Window|null} win
 * @param {object} mes    lo que devuelve `fetchMesImpreso`
 * @param {{dataUrl: string, ancho: number, alto: number}|null} [logo]
 * @returns {{ok: boolean, motivo?: string}}
 */
export function imprimirMesDeBitacoras(win, mes, logo = null) {
    if (!mes) {
        try { win?.close(); } catch { /* ya no está */ }
        return { ok: false, motivo: 'No hay nada que imprimir de ese mes.' };
    }
    return escribirEImprimir(win, armarHtmlDelMes(mes, logo));
}
