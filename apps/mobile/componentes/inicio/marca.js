// Los colores de la marca (tokens del portal: --brand, --success, --warning,
// --danger, --brand-purple). En hexadecimal a propósito: los widgets les pegan
// una transparencia para el fondo tintado, y a un color del sistema no se le
// puede.
import { Appearance, Platform } from 'react-native';
import { paletaDe } from '../../tema/material';
import { mezclar, PAPEL, papel } from '../../tema/papel';

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
// En iPhone, la línea Mostrador (Papel, tema/papel.js, 2026-11-19): la marca
// es el MAGENTA y los estados son los de Papel, leídos del modo actual:
//   · `azul`: el relleno de la marca (texto blanco encima: 7.1 en claro, 5.0
//     en oscuro).
//   · `azulClaro`: la marca como texto o ícono (en oscuro, aclarada hacia la
//     tinta para leerse sobre el casi negro).
//   · `verde`/`ambar`/`rojo`: éxito, aviso y falla. La app los usa como texto
//     y como relleno a la vez, y ~540 sitios los leen al CARGAR el módulo
//     (`const TONO = { bien: MARCA.verde }`): por eso son UN hex fijo para los
//     dos modos, la mezcla 40 % del token oscuro + 60 % del claro de Papel. Se
//     lee sobre el papel (≥ 3.8) y sobre el casi negro (≥ 4.4), y el blanco
//     encima se lee mejor que sobre el verde y el ámbar de antes (2.6 y 2.3).
// Los nombres se quedan (`azul`) porque los escriben ~850 sitios: cambiarlos
// es tocar cada pantalla sin cambiar nada de lo que se ve.
if (Platform.OS === 'ios') {
  const de = (token) => ({ enumerable: true, get: () => papel()[token] });
  Object.defineProperty(MARCA, 'azul', de('marca'));
  Object.defineProperty(MARCA, 'azulClaro', de('marcaTexto'));
  MARCA.verde = mezclar(PAPEL.oscuro.exito, PAPEL.claro.exito, 0.4);
  MARCA.ambar = mezclar(PAPEL.oscuro.aviso, PAPEL.claro.aviso, 0.4);
  MARCA.rojo = mezclar(PAPEL.oscuro.error, PAPEL.claro.error, 0.4);
}
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
