// El código de BARRAS de la tarjeta (2026-10-15): los lectores de la sala son
// de una dimensión —láser o CCD, conectados como teclado— y no leen el QR.
// Éste lleva el MISMO código de 7 caracteres que el QR lleva dentro de su
// dirección (`/mis-puntos?codigo=K7MP4XN`), pero pelado: el lector lo
// «teclea» tal cual, y es exactamente lo que acepta la búsqueda por código
// (`puntos_cliente_por_documento`, que limpia todo lo que no sea letra o dígito).
//
// Simbología Code 128, la que lee cualquier lector de mostrador. Se elige la
// codificación MÁS CORTA entre el juego B (un carácter por símbolo) y el C
// (dos dígitos por símbolo), con cambios de juego donde convienen: menos
// símbolos = barras más anchas en el mismo espacio = lectura más fácil.
// Lleva su dígito de control (módulo 103), arranque, cierre y zona de
// silencio de 10 módulos a cada lado —blanca, dentro del dibujo, para que no
// dependa de quien lo monte—.
//
// Nítido como el QR (componentes/CodigoQR.js): el módulo mide un número
// ENTERO de píxeles físicos y el dibujo se hace en píxeles, así cada borde de
// barra cae justo en el borde de un píxel —sin grises, que al láser le restan
// contraste—. Un solo `Path` estático, calculado una vez por código.
import { useMemo } from 'react';
import { PixelRatio, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

// ── codificador (puro, sin React: lo prueba un script aparte) ──
// Los 107 patrones de Code 128: anchos alternados barra/espacio, empezando por
// barra. Cada uno suma 11 módulos; el de cierre (106) suma 13.
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const INICIO_B = 104;
const INICIO_C = 105;
const A_B = 100; // desde C, pasar a B
const A_C = 99;  // desde B, pasar a C
const CIERRE = 106;
const SILENCIO = 10;

const esDigito = (c) => c >= '0' && c <= '9';

// Los valores de los símbolos (sin el control ni el cierre), o null si el
// texto tiene algo que el juego B no puede llevar (fuera de ASCII 32–126).
// Programación dinámica sobre (posición, juego): el mínimo exacto de símbolos.
export function simbolosCode128(texto) {
  const s = String(texto ?? '');
  const n = s.length;
  if (!n) return null;
  for (let i = 0; i < n; i++) {
    const k = s.charCodeAt(i);
    if (k < 32 || k > 126) return null;
  }
  const par = (i) => i + 1 < n && esDigito(s[i]) && esDigito(s[i + 1]);
  // fB[i] / fC[i]: símbolos que faltan desde i estando en B / en C.
  const fB = new Array(n + 1).fill(0);
  const fC = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const enB = 1 + fB[i + 1];                      // un carácter en B
    const cPar = par(i) ? 1 + fC[i + 2] : Infinity; // dos dígitos en C
    fB[i] = Math.min(enB, 1 + cPar);                // quedarse, o cambiar a C
    fC[i] = Math.min(cPar, 1 + enB);                // quedarse, o cambiar a B
  }
  // Empate: B, que es el arranque más común.
  let juego = fC[0] < fB[0] ? 'C' : 'B';
  const valores = [juego === 'C' ? INICIO_C : INICIO_B];
  let i = 0;
  while (i < n) {
    if (juego === 'B') {
      if (par(i) && 2 + fC[i + 2] < 1 + fB[i + 1]) { valores.push(A_C); juego = 'C'; continue; }
      valores.push(s.charCodeAt(i) - 32); i += 1;
    } else {
      if (par(i) && 1 + fC[i + 2] <= 2 + fB[i + 1]) { valores.push(Number(s.slice(i, i + 2))); i += 2; continue; }
      valores.push(A_B); juego = 'B';
    }
  }
  return valores;
}

// Todo el código: valores con el control y el cierre, y los anchos en módulos
// (barra, espacio, barra…) SIN la zona de silencio.
export function code128(texto) {
  const valores = simbolosCode128(texto);
  if (!valores) return null;
  let suma = valores[0];
  for (let k = 1; k < valores.length; k++) suma += valores[k] * k;
  const control = suma % 103;
  const todos = [...valores, control, CIERRE];
  const anchos = [];
  for (const v of todos) for (const ch of PATRONES[v]) anchos.push(Number(ch));
  const modulos = anchos.reduce((a, b) => a + b, 0);
  return { valores: todos, control, anchos, modulos, silencio: SILENCIO, patrones: PATRONES };
}
// ── fin del codificador ──

// `ancho`: lo más que puede medir, en puntos, CON la zona de silencio. El
// código queda igual o un poco más angosto (nunca más ancho): el módulo se
// redondea hacia abajo a píxeles enteros. `alto`: el de las barras.
export default function CodigoBarras({ value, ancho = 280, alto = 64, color = '#000000', backgroundColor = '#FFFFFF' }) {
  const dibujo = useMemo(() => {
    const c = code128(value);
    if (!c) return null;
    const densidad = PixelRatio.get();
    const total = c.modulos + 2 * c.silencio;
    const modulo = Math.max(1, Math.floor((ancho * densidad) / total));
    const altoPx = Math.max(1, Math.round(alto * densidad));
    let d = '';
    let x = c.silencio * modulo;
    for (let k = 0; k < c.anchos.length; k++) {
      const w = c.anchos[k] * modulo;
      if (k % 2 === 0) d += `M${x} 0h${w}v${altoPx}h${-w}z`;
      x += w;
    }
    const px = total * modulo;
    return { d, px, altoPx, pt: px / densidad, altoPt: altoPx / densidad };
  }, [value, ancho, alto]);
  if (!dibujo) return <View style={{ width: ancho, height: alto, backgroundColor }} />;
  return (
    <Svg width={dibujo.pt} height={dibujo.altoPt} viewBox={`0 0 ${dibujo.px} ${dibujo.altoPx}`}>
      <Rect x={0} y={0} width={dibujo.px} height={dibujo.altoPx} fill={backgroundColor} />
      <Path d={dibujo.d} fill={color} />
    </Svg>
  );
}
