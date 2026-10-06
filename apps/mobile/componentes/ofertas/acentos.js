// El color de cada acento de oferta en la app (`ACENTOS_DE_OFERTA` del núcleo
// es la lista; el portal la pinta con sus tokens y acá con los mismos valores).
import { MARCA } from '../inicio/marca';

export const COLOR_DE_ACENTO = {
  magenta: '#B83DB7', verde: '#8EC30F', azul: MARCA.azulClaro,
  naranja: MARCA.ambar, rojo: MARCA.rojo, violeta: MARCA.violetaClaro,
};
export const colorDeAcento = (a) => COLOR_DE_ACENTO[a] ?? COLOR_DE_ACENTO.magenta;

// La oferta abierta en el editor: la lista la deja acá al tocarla y el editor
// la lee, para no volver a pedir lo que ya está en pantalla.
let elegida = null;
export const guardarOferta = (o) => { elegida = o; };
export const ofertaElegida = () => elegida;
