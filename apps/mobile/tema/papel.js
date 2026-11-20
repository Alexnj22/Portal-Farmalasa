// La línea Mostrador en la app: Color A · Papel (docs/DISENO-MOSTRADOR.md §0).
// Son los DOCE tokens por modo del portal (`src/index.css`, bloque «ESTILO
// MOSTRADOR»), copiados tal cual: son los únicos hex de la línea, y todo lo
// demás sale de ellos o de una mezcla de ellos (`mezclar`, el `color-mix` del
// portal). Si el portal cambia uno, se cambia acá también.
//
// Se leen AL PINTAR (regla de gate:app-colores): `papel(oscuro)` dentro del
// componente, o los getters de `colorSistema` / `MARCA`, nunca congelados en
// un objeto de nivel de módulo.
import { Appearance, DynamicColorIOS, Platform } from 'react-native';

export const PAPEL = {
  claro: {
    fondo: '#f5efe6', superficie: '#fffcf7', hundida: '#efe7da', linea: '#e3d8c7',
    tinta: '#2b211b', tinta2: '#56493f', tinta3: '#6f6155',
    marca: '#981d97', marcaSuave: '#f4e2ef',
    exito: '#2f6a39', aviso: '#875400', error: '#ad2c25',
  },
  oscuro: {
    fondo: '#0d0b0a', superficie: '#171412', hundida: '#090807', linea: '#2b2521',
    tinta: '#f7f1ea', tinta2: '#cbbfb2', tinta3: '#9d9083',
    marca: '#b23cb0', marcaSuave: '#2f1a2d',
    exito: '#86c58f', aviso: '#e4b35c', error: '#f08b80',
  },
};

/** `color-mix(in srgb, a p%, b)` con dos hex de seis dígitos. */
export function mezclar(a, b, p) {
  const c = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(c(a, i) * p + c(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('')}`;
}

// Derivados (los mismos del portal):
//  · `marcaTexto`: la marca como texto; en oscuro, 55 % marca + 45 % tinta.
//  · `exitoVivo`/`avisoVivo`/`errorVivo`: el estado cuando el mismo color sirve
//    de texto Y de relleno con texto blanco (los `MARCA.verde/ambar/rojo` de
//    la app). En claro, el token; en oscuro, mitad del token oscuro y mitad
//    del claro: se lee sobre el casi negro (≥ 4.5) y el blanco encima no se
//    pierde como sobre el pastel.
function conDerivados(t, oscuro) {
  return {
    ...t,
    marcaTexto: oscuro ? mezclar(t.marca, t.tinta, 0.55) : t.marca,
    exitoVivo: oscuro ? mezclar(PAPEL.oscuro.exito, PAPEL.claro.exito, 0.5) : t.exito,
    avisoVivo: oscuro ? mezclar(PAPEL.oscuro.aviso, PAPEL.claro.aviso, 0.5) : t.aviso,
    errorVivo: oscuro ? mezclar(PAPEL.oscuro.error, PAPEL.claro.error, 0.5) : t.error,
  };
}
const CLARO = conDerivados(PAPEL.claro, false);
const OSCURO = conDerivados(PAPEL.oscuro, true);

/** Los tokens del modo pedido (o del modo actual del teléfono). */
export function papel(oscuro = Appearance.getColorScheme() === 'dark') {
  return oscuro ? OSCURO : CLARO;
}

/** En iPhone, un color que cambia SOLO con el modo (lo resuelve el sistema,
 *  como los `PlatformColor` de antes): sirve en vistas de React Native y en las
 *  piezas de @expo/ui. Fuera de iPhone, el hex del modo actual. */
export function dinamico(nombre) {
  if (Platform.OS === 'ios') return DynamicColorIOS({ light: CLARO[nombre], dark: OSCURO[nombre] });
  return papel()[nombre];
}

/** El relieve (Forma C): luz interior de 1px, contacto y ambiente. Como
 *  `boxShadow` de React Native (nueva arquitectura). */
export function relieve(oscuro, nivel = 'tarjeta') {
  const luz = oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)';
  const contacto = oscuro ? 'rgba(0,0,0,0.50)' : 'rgba(0,0,0,0.08)';
  const ambiente = oscuro ? 'rgba(0,0,0,0.60)' : 'rgba(0,0,0,0.28)';
  if (nivel === 'control') return `inset 0 1px 0 ${luz}, 0 1px 2px ${contacto}, 0 6px 14px -8px ${ambiente}`;
  return `inset 0 1px 0 ${luz}, 0 1px 2px ${contacto}, 0 12px 32px -12px ${ambiente}`;
}

/** El pozo (Campos B, vacíos A): la sombra interior de lo hundido. */
export function pozo(oscuro) {
  return `inset 0 2px 4px ${oscuro ? 'rgba(0,0,0,0.50)' : 'rgba(0,0,0,0.08)'}`;
}

/** Radios de la línea: contenedores concéntricos y controles en píldora. */
export const RADIO = { tarjeta: 28, variasLineas: 22, renglon: 16, pildora: 999, dialogo: 32 };
