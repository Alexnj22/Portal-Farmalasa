// Imprimir — la versión del TELÉFONO. Gemelo de `src/plataforma/impresion.js`.
//
// El teléfono no tiene diálogo de impresión ni impresora enchufada: el papel
// sale por la COLA de la sala (`encolar_impresion`), que lee el agente de la
// caja. Ese camino es texto puro (`textoParaElRollo` + `ticketEnBase64`) y no
// pasa por acá; lo arma `componentes/imprimir.js`. Lo de este archivo es lo que
// sólo existe en un navegador, y se dice en voz alta en vez de fingirlo.
import { pendiente } from './_pendiente';

// ── El código de barras, dibujado acá ──────────────────────────────────────
// El portal lo dibuja con `jsbarcode`, que necesita el DOM. En el teléfono lo
// que hace falta es el SVG para una hoja de AirPrint (la etiqueta del carné de
// plástico, los códigos de un ticket en PDF), y CODE128 es una tabla y una
// suma: se arma acá, sin librería. Va en el juego B entero (letras y números,
// que es lo único que deja pasar `limpiarValorDeBarras`): las barras no son
// las mismas que elegiría `jsbarcode` en su modo automático, pero el lector
// lee el MISMO valor. La tabla es la de la norma (la misma de `jsbarcode`).
const BARRAS_128 = [11011001100, 11001101100, 11001100110, 10010011000, 10010001100, 10001001100, 10011001000, 10011000100, 10001100100, 11001001000, 11001000100, 11000100100, 10110011100, 10011011100, 10011001110, 10111001100, 10011101100, 10011100110, 11001110010, 11001011100, 11001001110, 11011100100, 11001110100, 11101101110, 11101001100, 11100101100, 11100100110, 11101100100, 11100110100, 11100110010, 11011011000, 11011000110, 11000110110, 10100011000, 10001011000, 10001000110, 10110001000, 10001101000, 10001100010, 11010001000, 11000101000, 11000100010, 10110111000, 10110001110, 10001101110, 10111011000, 10111000110, 10001110110, 11101110110, 11010001110, 11000101110, 11011101000, 11011100010, 11011101110, 11101011000, 11101000110, 11100010110, 11101101000, 11101100010, 11100011010, 11101111010, 11001000010, 11110001010, 10100110000, 10100001100, 10010110000, 10010000110, 10000101100, 10000100110, 10110010000, 10110000100, 10011010000, 10011000010, 10000110100, 10000110010, 11000010010, 11001010000, 11110111010, 11000010100, 10001111010, 10100111100, 10010111100, 10010011110, 10111100100, 10011110100, 10011110010, 11110100100, 11110010100, 11110010010, 11011011110, 11011110110, 11110110110, 10101111000, 10100011110, 10001011110, 10111101000, 10111100010, 11110101000, 11110100010, 10111011110, 10111101110, 11101011110, 11110101110, 11010000100, 11010010000, 11010011100, 1100011101011];
const INICIO_B = 104;
const FIN = 106;

/** Los módulos (1 = barra, 0 = espacio) de un valor en CODE128-B. */
export function modulosCode128(limpio) {
  const valores = [...String(limpio)].map((c) => c.charCodeAt(0) - 32);
  if (!valores.length || valores.some((v) => v < 0 || v > 95)) return '';
  const suma = valores.reduce((s, v, i) => s + v * (i + 1), INICIO_B) % 103;
  return [INICIO_B, ...valores, suma, FIN].map((v) => String(BARRAS_128[v])).join('');
}

/** Un código de barras como SVG serializado — gemelo del de la web. */
export async function svgDeCodigoDeBarras(limpio, simbologia = 'CODE128') {
  if (simbologia !== 'CODE128') throw pendiente(`dibujar un código ${simbologia}`);
  const modulos = modulosCode128(limpio);
  if (!modulos) return '';
  const ancho = 2;
  const alto = 50;
  let rects = '';
  for (let i = 0; i < modulos.length;) {
    if (modulos[i] !== '1') { i += 1; continue; }
    let j = i;
    while (modulos[j] === '1') j += 1;
    rects += `<rect x="${i * ancho}" y="0" width="${(j - i) * ancho}" height="${alto}"/>`;
    i = j;
  }
  const w = modulos.length * ancho;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${alto}" viewBox="0 0 ${w} ${alto}"><g fill="#000">${rects}</g></svg>`;
}
export function ajustarAltoDelMarco() { throw pendiente('la vista previa de impresión'); }
export function imprimirMarco() { throw pendiente('el diálogo de impresión'); }
export function imprimirHtmlSinVista() { throw pendiente('el diálogo de impresión'); }
// null = «no se sabe», que es el contrato del gemelo web.
export async function permisoDeRedLocal() { return null; }
