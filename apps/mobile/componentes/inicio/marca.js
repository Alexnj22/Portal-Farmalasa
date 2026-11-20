// Los colores de la marca (tokens del portal: --brand, --success, --warning,
// --danger, --brand-purple). En hexadecimal a propósito: los widgets les pegan
// una transparencia para el fondo tintado, y a un color del sistema no se le
// puede.
import { Appearance, Platform } from 'react-native';
import { paletaDe } from '../../tema/material';

export const MARCA = { rosa: '#E0457B', amarillo: '#EAB308', azulInfo: '#1192E8', gris: '#8E8E93', azul: '#0052CC', azulClaro: '#3B82F6', verde: '#12B76A', ambar: '#F79009', rojo: '#F04438', violeta: '#6929C4', violetaClaro: '#A78BFA' };

// Android toma el color principal del SISTEMA (Material You, decisión del
// usuario), y la app escribe `MARCA.azul`/`MARCA.azulClaro` en ~850 sitios:
// botones, enlaces, íconos, fichas elegidas. En vez de tocarlos uno por uno,
// en Android esos dos son el primario de la paleta del sistema leída EN VIVO
// (tema/material.js):
//   · `azul` (fondos con texto blanco encima): el primario del esquema CLARO,
//     un tono saturado sobre el que el blanco se lee en los dos modos.
//   · `azulClaro` (texto e íconos): el primario del modo actual — claro en
//     oscuro, saturado en claro —, el que se lee sobre el fondo.
// Sin alfa (#RRGGBB): muchas pantallas le pegan una transparencia («+ '22'»).
// Verde, ámbar, rojo y violeta son SEMÁNTICOS (estado) y no cambian.
// En iPhone nada cambia: es el azul de la marca.
if (Platform.OS === 'android') {
  const primario = (oscuro, fijo) => () => {
    const p = paletaDe(oscuro())?.primary;
    return typeof p === 'string' && p.length >= 7 ? p.slice(0, 7) : fijo;
  };
  Object.defineProperty(MARCA, 'azul', { enumerable: true, get: primario(() => false, '#0052CC') });
  Object.defineProperty(MARCA, 'azulClaro', { enumerable: true, get: primario(() => Appearance.getColorScheme() === 'dark', '#3B82F6') });
}

// El fondo de un control sobre vidrio (campos, fichas sin elegir).
export const FONDO_CONTROL = 'rgba(127,127,127,0.16)';
// El petróleo de la marca de la distribuidora (COLORES_DISTRIBUIDORA.petroleo).
export const PETROLEO = '#0f6e7d';

// El texto sobre un relleno de color, en Android: blanco o casi negro según
// cuánta luz tenga el fondo (lo que Material 3 llama «on-color»). Hace falta
// porque `MARCA.azulClaro` es el primario del modo actual: en oscuro es un
// tono CLARO, y el texto blanco de siempre encima no se leía. En iPhone, el
// blanco de siempre (los colores de la marca son oscuros).
export function tintaSobre(fondo, blanco = '#FFFFFF') {
  if (Platform.OS !== 'android' || typeof fondo !== 'string' || !/^#[0-9a-f]{6}/i.test(fondo)) return blanco;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(fondo.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Sólo los rellenos CLAROS (los tonos pastel del modo oscuro de Material)
  // llevan texto oscuro; el verde, el rojo y el ámbar de siempre siguen con
  // el blanco de la marca.
  return luz > 0.4 ? '#1C1B1F' : blanco;
}
