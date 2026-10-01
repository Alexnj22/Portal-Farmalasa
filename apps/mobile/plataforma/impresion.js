// Imprimir — la versión del TELÉFONO. Gemelo de `src/plataforma/impresion.js`.
//
// El teléfono no tiene diálogo de impresión ni impresora enchufada: el papel
// sale por la COLA de la sala (`encolar_impresion`), que lee el agente de la
// caja. Ese camino es texto puro (`textoParaElRollo` + `ticketEnBase64`) y no
// pasa por acá; lo arma `componentes/imprimir.js`. Lo de este archivo es lo que
// sólo existe en un navegador, y se dice en voz alta en vez de fingirlo.
import { pendiente } from './_pendiente';

export async function svgDeCodigoDeBarras() { throw pendiente('dibujar un código de barras'); }
export function ajustarAltoDelMarco() { throw pendiente('la vista previa de impresión'); }
export function imprimirMarco() { throw pendiente('el diálogo de impresión'); }
export function imprimirHtmlSinVista() { throw pendiente('el diálogo de impresión'); }
// null = «no se sabe», que es el contrato del gemelo web.
export async function permisoDeRedLocal() { return null; }
