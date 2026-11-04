// Botiquín (Bienestar, 2026-11-04) — reemplaza al «Botiquín» anterior, el de
// unir piezas en un tablero (usuario: «debía quitar el juego anterior, no era
// uno más»). Nació como «Pastillero»; las claves del récord conservan ese
// nombre para no perder lo ya jugado en la 94.
// Pedido del usuario: un juego de «juntar
// al caer» —caen medicamentos dentro de un botiquín abierto arriba; dos iguales
// que se tocan se vuelven el siguiente— con nombre, dibujos, colores y sonidos
// propios, de farmacia. No es copia de ningún juego: la cadena, el arte y las
// reglas finas son nuestras.
//
// La cadena (diez, de la más chica a la más grande):
//   Pastilla → Gragea → Cápsula → Perla → Sobre → Pomada → Jarabe → Frasco
//   → Caja → Cruz de farmacia.
// Sólo las cinco primeras caen al azar; el resto se gana juntando. Dos cruces
// juntas se van con un premio y dejan espacio. Se pierde si algo que ya cayó
// queda por encima del borde del botiquín DOS segundos seguidos (el que viene
// cayendo no cuenta): así una pila que asoma un instante no castiga.
//
// Rendimiento: la física (lib/caida.js) corre en JavaScript con
// `requestAnimationFrame`, en pasos fijos de 1/120 s (0.03 ms por paso), y le
// pasa al hilo de la interfaz una foto de puros números. Allá un solo `Picture`
// estampa cada pieza, que se dibujó UNA vez como imagen al medir la pantalla
// (nada de rearmar formas en cada cuadro). Una falla del motor termina la
// partida y se reporta; nunca cierra la app. Con la pantalla fuera de vista o
// la app en segundo plano el reloj se para (`useVisible`) y al volver queda en
// pausa hasta que se toque «Seguir».
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { BlurStyle, Canvas, ClipOp, FilterMode, Image as ImagenSkia, MipmapMode, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, TileMode } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import tokens from '@nucleo/constants/tokens.json';
import { Confeti, Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { AvisoJuego, BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, PanelVidrio, VIDRIO, VIDRIO_BORDE, textoAyuda } from '../componentes/juegos/Escena';
import { ORO, TarjetaNivel } from '../componentes/juegos/Niveles';
import { ALTURA_SOLTAR, MAX, PAUSA_SOLTAR, PREMIO_CUMBRE, RADIOS, avanzar, crearMundo, soltar } from '../lib/caida';
import { entero } from '../lib/formato';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';
import { useVisible } from '../lib/visible';
import { reportarError } from '../lib/errores';

const CLAVE_RECORD = 'puntos_salud_pastillero_record';
const CLAVE_MAYOR = 'puntos_salud_pastillero_mayor'; // la pieza más grande que se llegó a hacer
const SONIDOS = ['gota', 'pop-1', 'pop-2', 'pop-3', 'pop-4', 'pop-5', 'pop-6', 'par', 'ganar', 'fallo', 'derrumbe'];

const ALTO = 1.3; // el botiquín, en anchos: un poco más alto que ancho
const ZONA = 0.36; // el aire de arriba, donde cuelga la pieza que se va a soltar
const PARED = 0.045; // grosor de las paredes, en anchos

export const NOMBRES = ['Pastilla', 'Gragea', 'Cápsula', 'Perla', 'Sobre', 'Pomada', 'Jarabe', 'Frasco', 'Caja', 'Cruz de farmacia'];
const ARTICULO = ['la', 'la', 'la', 'la', 'el', 'la', 'el', 'el', 'la', 'la'];

// Los colores de la marca salen de los tokens (la escena es la misma en tema
// claro y oscuro, como en todos los juegos: oscura a propósito, con todo
// blanco encima). Los demás tonos son de esta cadena; cada pieza tiene forma
// Y color propios, para distinguirlas también sin ver colores.
const T = tokens.temas.solid;
const COLORES = [
  ['#E4EEFF', '#6F95D6'], // pastilla · celeste
  ['#F6C9EF', T['logo-magenta']], // gragea · magenta del logo
  ['#FFD0AC', '#E66A2C'], // cápsula · naranja
  ['#FFF0B0', '#D59E00'], // perla · miel
  ['#C8F3DB', '#1E9E68'], // sobre · menta
  ['#FFC0CB', '#D8405A'], // pomada · coral
  ['#D8C9FF', T['brand-purple']], // jarabe · violeta
  ['#B4D6FF', T.brand], // frasco · azul de la marca
  ['#A8ECE6', '#0F8C88'], // caja · turquesa
  ['#E2F7A8', T['logo-green-solid']], // cruz · verde del logo
];
const VERDE = T['logo-green'];
const PELIGRO = '#FF6B7E';

// ── Pinceles para el horneado (corren en JavaScript, una vez) ────────────────
const pincel = (color) => { const p = Skia.Paint(); p.setAntiAlias(true); p.setColor(Skia.Color(color)); return p; };
const trazo = (color, ancho) => {
  const p = pincel(color); p.setStyle(PaintStyle.Stroke); p.setStrokeWidth(ancho); p.setStrokeCap(StrokeCap.Round); p.setStrokeJoin(StrokeJoin.Round); return p;
};
const degradado = (x0, y0, x1, y1, colores) => {
  const p = Skia.Paint(); p.setAntiAlias(true);
  p.setShader(Skia.Shader.MakeLinearGradient(Skia.Point(x0, y0), Skia.Point(x1, y1), colores.map((c) => Skia.Color(c)), null, TileMode.Clamp));
  return p;
};
const radial = (x, y, r, colores) => {
  const p = Skia.Paint(); p.setAntiAlias(true);
  p.setShader(Skia.Shader.MakeRadialGradient(Skia.Point(x, y), r, colores.map((c) => Skia.Color(c)), null, TileMode.Clamp));
  return p;
};
const rr = (x, y, w, h, r) => Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r);

function cruz(c, m, n, L, g, p) {
  c.drawRRect(rr(m - g, n - L, g * 2, L * 2, g * 0.45), p);
  c.drawRRect(rr(m - L, n - g, L * 2, g * 2, g * 0.45), p);
}

// El dibujo de cada pieza, centrado en (m, n), en una caja de lado ~k.
function icono(c, nivel, m, n, k, claro, fuerte) {
  const sombra = pincel('rgba(10,20,50,0.22)');
  switch (nivel) {
    case 0: { // Pastilla: un disco blanco con su ranura
      c.drawCircle(m, n + k * 0.04, k * 0.4, sombra);
      c.drawCircle(m, n, k * 0.4, degradado(m, n - k * 0.4, m, n + k * 0.4, ['#FFFFFF', '#E1E9F5']));
      c.drawCircle(m, n, k * 0.4, trazo('rgba(60,90,150,0.28)', k * 0.03));
      c.drawLine(m - k * 0.26, n, m + k * 0.26, n, trazo('rgba(60,90,150,0.45)', k * 0.06));
      break;
    }
    case 1: { // Gragea: un óvalo brillante, inclinado
      c.save(); c.rotate(-30, m, n);
      c.drawOval(Skia.XYWHRect(m - k * 0.44, n - k * 0.26 + k * 0.04, k * 0.88, k * 0.52), sombra);
      c.drawOval(Skia.XYWHRect(m - k * 0.44, n - k * 0.26, k * 0.88, k * 0.52), degradado(m, n - k * 0.26, m, n + k * 0.26, ['#FFE2F8', fuerte]));
      c.drawOval(Skia.XYWHRect(m - k * 0.28, n - k * 0.2, k * 0.34, k * 0.12), pincel('rgba(255,255,255,0.75)'));
      c.restore();
      break;
    }
    case 2: { // Cápsula: dos mitades, blanca y de color
      c.save(); c.rotate(-40, m, n);
      const L = k * 0.5; const A = k * 0.21;
      c.drawRRect(rr(m - L, n - A + k * 0.04, L * 2, A * 2, A), sombra);
      c.drawRRect(rr(m - L, n - A, L * 2, A * 2, A), degradado(m, n - A, m, n + A, ['#FFFFFF', '#E6ECF5']));
      c.save(); c.clipRect(Skia.XYWHRect(m, n - A - 1, L + 1, A * 2 + 2), ClipOp.Intersect, true);
      c.drawRRect(rr(m - L, n - A, L * 2, A * 2, A), degradado(m, n - A, m, n + A, [claro, fuerte]));
      c.restore();
      c.drawLine(m, n - A, m, n + A, trazo('rgba(0,0,0,0.15)', k * 0.025));
      c.drawRRect(rr(m - L * 0.8, n - A * 0.65, L * 1.6, A * 0.42, A * 0.2), pincel('rgba(255,255,255,0.55)'));
      c.restore();
      break;
    }
    case 3: { // Perla: la cápsula blanda, dorada y translúcida
      c.drawOval(Skia.XYWHRect(m - k * 0.36, n - k * 0.3 + k * 0.05, k * 0.72, k * 0.6), sombra);
      c.drawOval(Skia.XYWHRect(m - k * 0.36, n - k * 0.3, k * 0.72, k * 0.6), radial(m - k * 0.1, n - k * 0.12, k * 0.5, ['#FFF7D0', '#F5BF1C', '#B07C00']));
      c.drawLine(m - k * 0.36, n, m + k * 0.36, n, trazo('rgba(140,90,0,0.3)', k * 0.02));
      c.drawOval(Skia.XYWHRect(m - k * 0.22, n - k * 0.22, k * 0.22, k * 0.13), pincel('rgba(255,255,255,0.85)'));
      break;
    }
    case 4: { // Sobre: un sachet con bordes en zigzag y su cruz
      const w = k * 0.42; const h = k * 0.4; const z = k * 0.06;
      const p = Skia.Path.Make();
      p.moveTo(m - w, n - h);
      for (let i = 0; i < 6; i++) { p.lineTo(m - w + ((i + 0.5) * 2 * w) / 6, n - h - z); p.lineTo(m - w + ((i + 1) * 2 * w) / 6, n - h); }
      p.lineTo(m + w, n + h);
      for (let i = 0; i < 6; i++) { p.lineTo(m + w - ((i + 0.5) * 2 * w) / 6, n + h + z); p.lineTo(m + w - ((i + 1) * 2 * w) / 6, n + h); }
      p.close();
      c.save(); c.translate(0, k * 0.04); c.drawPath(p, sombra); c.restore();
      c.drawPath(p, degradado(m, n - h, m, n + h, ['#FFFFFF', '#E7EEF6']));
      c.drawLine(m - w, n - h * 0.55, m + w, n - h * 0.55, trazo('rgba(0,0,0,0.12)', k * 0.025));
      cruz(c, m, n + h * 0.15, k * 0.17, k * 0.06, pincel(fuerte));
      break;
    }
    case 5: { // Pomada: el tubo con su tapa
      c.save(); c.rotate(-35, m, n);
      const L = k * 0.52; const A = k * 0.2;
      const p = Skia.Path.Make();
      p.moveTo(m - L, n - A * 1.15); p.lineTo(m + L * 0.55, n - A); p.lineTo(m + L * 0.55, n + A); p.lineTo(m - L, n + A * 1.15); p.close();
      c.save(); c.translate(0, k * 0.04); c.drawPath(p, sombra); c.restore();
      c.drawPath(p, degradado(m, n - A, m, n + A, ['#FFFFFF', '#E3EAF3']));
      c.drawRect(Skia.XYWHRect(m - L * 0.35, n - A, L * 0.5, A * 2), pincel(fuerte));
      for (let i = 0; i < 3; i++) c.drawLine(m - L + k * 0.04 + i * k * 0.04, n - A * 1.1, m - L + k * 0.04 + i * k * 0.04, n + A * 1.1, trazo('rgba(0,0,0,0.14)', k * 0.018));
      c.drawRRect(rr(m + L * 0.55, n - A * 0.7, L * 0.45, A * 1.4, A * 0.3), degradado(m, n - A, m, n + A, [claro, fuerte]));
      c.restore();
      break;
    }
    case 6: { // Jarabe: el frasco ámbar con su etiqueta
      const w = k * 0.3; const top = n - k * 0.08; const h = k * 0.5;
      c.drawRRect(rr(m - w, top + k * 0.04, w * 2, h, k * 0.1), sombra);
      c.drawRect(Skia.XYWHRect(m - k * 0.1, n - k * 0.3, k * 0.2, k * 0.24), degradado(m, 0, m + 1, 0, ['#E59A4E', '#A4501A']));
      c.drawRRect(rr(m - k * 0.14, n - k * 0.44, k * 0.28, k * 0.15, k * 0.04), degradado(m, n - k * 0.44, m, n - k * 0.29, [claro, fuerte]));
      c.drawRRect(rr(m - w, top, w * 2, h, k * 0.1), degradado(m - w, top, m + w, top, ['#F0A85A', '#A4501A']));
      c.drawRRect(rr(m - w * 0.78, top + h * 0.28, w * 1.56, h * 0.46, k * 0.04), pincel('#FFFFFF'));
      c.drawLine(m - w * 0.5, top + h * 0.44, m + w * 0.5, top + h * 0.44, trazo(fuerte, k * 0.04));
      c.drawLine(m - w * 0.5, top + h * 0.58, m + w * 0.2, top + h * 0.58, trazo('rgba(0,0,0,0.2)', k * 0.03));
      c.drawRect(Skia.XYWHRect(m - w * 0.75, top + k * 0.04, w * 0.18, h * 0.8), pincel('rgba(255,255,255,0.35)'));
      break;
    }
    case 7: { // Frasco de pastillas: tapa con estrías y etiqueta
      const w = k * 0.32; const top = n - k * 0.2; const h = k * 0.56;
      c.drawRRect(rr(m - w, top + k * 0.04, w * 2, h, k * 0.08), sombra);
      c.drawRRect(rr(m - w, top, w * 2, h, k * 0.08), degradado(m - w, 0, m + w, 0, ['#FFFFFF', '#DCE5F0']));
      c.drawRect(Skia.XYWHRect(m - w, top + h * 0.3, w * 2, h * 0.42), pincel(fuerte));
      c.drawCircle(m, top + h * 0.51, k * 0.1, pincel('#FFFFFF'));
      c.drawLine(m - k * 0.06, top + h * 0.51, m + k * 0.06, top + h * 0.51, trazo(fuerte, k * 0.03));
      c.drawRRect(rr(m - w * 1.08, n - k * 0.4, w * 2.16, k * 0.2, k * 0.05), degradado(m, n - k * 0.4, m, n - k * 0.2, ['#FFFFFF', '#C9D4E2']));
      for (let i = 1; i < 6; i++) c.drawLine(m - w * 1.08 + (i * w * 2.16) / 6, n - k * 0.37, m - w * 1.08 + (i * w * 2.16) / 6, n - k * 0.23, trazo('rgba(0,0,0,0.13)', k * 0.02));
      break;
    }
    case 8: { // Caja de medicina: frente, tapa en perspectiva, franja y cruz
      const w = k * 0.42; const top = n - k * 0.12; const h = k * 0.44; const d = k * 0.14;
      c.drawRect(Skia.XYWHRect(m - w, top + k * 0.05, w * 2, h), sombra);
      const tapa = Skia.Path.Make();
      tapa.moveTo(m - w, top); tapa.lineTo(m - w + d, top - d); tapa.lineTo(m + w + d * 0.4, top - d); tapa.lineTo(m + w, top); tapa.close();
      c.drawPath(tapa, pincel('#F4F8FC'));
      c.drawRect(Skia.XYWHRect(m - w, top, w * 2, h), degradado(m, top, m, top + h, ['#FFFFFF', '#E2E9F2']));
      c.drawRect(Skia.XYWHRect(m - w, top + h * 0.62, w * 2, h * 0.2), pincel(fuerte));
      cruz(c, m - w * 0.45, top + h * 0.32, k * 0.1, k * 0.035, pincel(fuerte));
      c.drawLine(m - w * 0.05, top + h * 0.26, m + w * 0.7, top + h * 0.26, trazo('rgba(0,0,0,0.25)', k * 0.03));
      c.drawLine(m - w * 0.05, top + h * 0.42, m + w * 0.45, top + h * 0.42, trazo('rgba(0,0,0,0.15)', k * 0.025));
      break;
    }
    default: { // Cruz de farmacia: la cruz verde, con su luz
      const L = k * 0.46; const g = k * 0.16;
      const luz = pincel('rgba(200,255,120,0.55)');
      luz.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, k * 0.08, true));
      cruz(c, m, n, L, g, luz);
      cruz(c, m, n, L, g, degradado(m, n - L, m, n + L, ['#D4F57A', VERDE, fuerte]));
      const borde = trazo('rgba(255,255,255,0.85)', k * 0.03);
      c.drawRRect(rr(m - g, n - L, g * 2, L * 2, g * 0.45), borde);
      c.drawRRect(rr(m - L, n - g, L * 2, g * 2, g * 0.45), borde);
      cruz(c, m, n, L - k * 0.05, g - k * 0.05, degradado(m, n - L, m, n + L, ['#D4F57A', VERDE, fuerte]));
      c.drawRRect(rr(m - g * 0.6, n - L * 0.85, g * 1.2, L * 0.4, g * 0.3), pincel('rgba(255,255,255,0.4)'));
    }
  }
}

// Una pieza como imagen de diámetro D (a la densidad del teléfono): el disco
// de su color con el borde de vidrio, el dibujo adentro y un brillo arriba.
function hornearPieza(nivel, D) {
  const d = PixelRatio.get();
  const lado = Math.max(4, Math.ceil(D * d));
  const sup = Skia.Surface.Make(lado, lado);
  if (!sup) return null;
  const c = sup.getCanvas();
  c.scale(lado / D, lado / D);
  const R = D / 2; const m = R;
  const [claro, fuerte] = COLORES[nivel];
  c.drawCircle(m, m, R - 0.4, radial(m - R * 0.3, m - R * 0.4, R * 1.5, [claro, fuerte]));
  c.drawCircle(m, m, R - Math.max(1, R * 0.06), trazo('rgba(0,0,0,0.14)', Math.max(1, R * 0.05)));
  c.drawCircle(m, m, R - 0.8, trazo(nivel === MAX ? '#FFFFFF' : 'rgba(255,255,255,0.6)', Math.max(1, R * (nivel === MAX ? 0.07 : 0.04))));
  icono(c, nivel, m, m + R * 0.02, R * 1.3, claro, fuerte);
  c.drawOval(Skia.XYWHRect(m - R * 0.55, m - R * 0.82, R * 0.75, R * 0.32), pincel('rgba(255,255,255,0.28)'));
  sup.flush();
  return sup.makeImageSnapshot();
}
function hornearPiezas(escala) {
  const piezas = []; const src = [];
  for (let n = 0; n <= MAX; n++) {
    const img = hornearPieza(n, RADIOS[n] * 2 * escala);
    if (!img) return null;
    piezas.push(img); src.push(Skia.XYWHRect(0, 0, img.width(), img.height()));
  }
  return { piezas, src };
}

// El botiquín: fondo de vidrio con una cruz grande y tenue, paredes blancas
// de estuche y la cruz verde en la base. Se graba una vez por medida.
function grabarBotiquin(g) {
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, g.W, g.H));
  const { ox, oy, S } = g; const P = PARED * S; const H = ALTO * S;
  c.drawRRect(rr(ox, oy - P * 0.4, S, H + P * 0.4, P * 0.6), degradado(0, oy, 0, oy + H, ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.15)']));
  cruz(c, ox + S / 2, oy + H * 0.58, S * 0.26, S * 0.085, pincel('rgba(255,255,255,0.06)'));
  const sombra = pincel('rgba(0,10,20,0.35)');
  sombra.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, P * 0.8, true));
  c.drawRRect(rr(ox - P, oy + H + P * 0.6, S + P * 2, P, P * 0.5), sombra);
  const pared = degradado(0, oy, 0, oy + H, ['#FFFFFF', '#D9E2EE']);
  c.drawRRect(rr(ox - P, oy - P * 0.6, P, H + P * 1.6, P * 0.5), pared);
  c.drawRRect(rr(ox + S, oy - P * 0.6, P, H + P * 1.6, P * 0.5), pared);
  c.drawRRect(rr(ox - P, oy + H, S + P * 2, P, P * 0.5), degradado(0, oy + H, 0, oy + H + P, ['#E9EFF6', '#C9D4E2']));
  // Los broches de arriba y la cruz de la base.
  c.drawRRect(rr(ox - P * 1.25, oy - P * 0.2, P * 1.5, P * 0.9, P * 0.3), pincel(VERDE));
  c.drawRRect(rr(ox + S - P * 0.25, oy - P * 0.2, P * 1.5, P * 0.9, P * 0.3), pincel(VERDE));
  cruz(c, ox + S / 2, oy + H + P / 2, P * 0.36, P * 0.13, pincel(T['logo-green-solid']));
  return rec.finishRecordingAsPicture();
}

function medir(W, H) {
  if (!W || !H) return null;
  const S = Math.floor(Math.min(W / (1 + PARED * 2 + 0.04), H / (ZONA + ALTO + PARED + 0.04)));
  const usado = S * (ZONA + ALTO + PARED);
  return { W, H, S, ox: (W - S) / 2, oy: (H - usado) / 2 + S * ZONA };
}

// La cadena de la portada y del final: las diez en una sola imagen.
function Cadena({ chicas, mayor }) {
  const [w, setW] = useState(0);
  const gap = 4;
  const s = w ? Math.min(44, (w - gap * 4) / 5) : 0;
  const pic = useMemo(() => {
    if (!w || !chicas) return null;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, w, s * 2 + gap));
    const x0 = (w - (s * 5 + gap * 4)) / 2;
    const p = Skia.Paint();
    for (let i = 0; i <= MAX; i++) {
      const x = x0 + (i % 5) * (s + gap); const y = Math.floor(i / 5) * (s + gap);
      p.setAlphaf(mayor == null || i <= mayor ? 1 : 0.3);
      c.drawImageRectOptions(chicas.piezas[i], chicas.src[i], Skia.XYWHRect(x, y, s, s), FilterMode.Linear, MipmapMode.Linear, p);
    }
    return rec.finishRecordingAsPicture();
  }, [w, s, chicas, mayor]);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: (s || 40) * 2 + gap }} accessible
      accessibilityLabel={`La cadena: ${NOMBRES.join(', ')}.${mayor != null ? ` Tu pieza más grande: ${NOMBRES[mayor]}.` : ''}`}>
      {pic ? <Canvas style={{ flex: 1 }}><Picture picture={pic} /></Canvas> : null}
    </View>
  );
}

function PiezaChica({ chicas, nivel, tam = 34 }) {
  if (!chicas) return <View style={{ width: tam, height: tam }} />;
  return (
    <Canvas style={{ width: tam, height: tam }}>
      <ImagenSkia image={chicas.piezas[nivel]} x={0} y={0} width={tam} height={tam} fit="contain" />
    </Canvas>
  );
}

function BotonChico({ sf, etiqueta, alTocar }) {
  return (
    <Tocable etiqueta={etiqueta} alTocar={() => { tacto.roce(); alTocar(); }}>
      <View style={estilos.redondo}><Icono sf={sf} respaldo="" tam={18} color={BLANCO} /></View>
    </Tocable>
  );
}

// La foto que cruza al hilo de la interfaz en cada cuadro: sólo números, 5 por
// pieza (nivel, x, y, giro, escala) y 5 por anillo (x, y, radio, nivel, avance).
// El saltito de una pieza recién unida y el avance de los anillos se calculan
// acá, así el dibujo no recorre nada que no vaya a pintar.
function fotografiar(m, mov, cuelga) {
  const cs = m.cuerpos; const c = new Array(cs.length * 5); let k = 0;
  for (let i = 0; i < cs.length; i++) {
    const b = cs[i]; let esc = 1;
    if (b.junta && mov) { const q = (m.t - b.nace) / 0.28; if (q < 1) esc = 1 + 0.18 * Math.sin(q * Math.PI); }
    c[k++] = b.n; c[k++] = b.x; c[k++] = b.y; c[k++] = b.ang; c[k++] = esc;
  }
  const a = [];
  if (mov) {
    for (let i = 0; i < m.anillos.length; i++) {
      const r = m.anillos[i]; const q = (m.t - r.t) / 0.5;
      if (q >= 0 && q < 1) a.push(r.x, r.y, r.r, r.n, q);
    }
  }
  return {
    t: m.t, peligro: m.peligro, actual: m.actual, c, a,
    cuelga: cuelga && !m.perdio,
    lista: m.t - m.ultimaSoltada >= PAUSA_SOLTAR,
  };
}

export default function Botiquin() {
  const quieta = useSinMovimiento();
  const visible = useVisible();
  const [fase, setFase] = useState('portada'); // portada · jugando · fin
  const [pausa, setPausa] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [record, setRecord] = useState(0);
  const [mayorHistorico, setMayorHistorico] = useState(null);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const [actual, setActual] = useState(0);
  const [siguiente, setSiguiente] = useState(0);
  const [mayor, setMayor] = useState(0);
  const [cuantas, setCuantas] = useState(0);
  const [aviso, setAviso] = useState(null);
  const [festejo, setFestejo] = useState(0);
  const [caja, setCaja] = useState(null);
  const recordRef = useRef(0);
  const mayorHistRef = useRef(-1);
  const racha = useRef({ n: 0, t: 0 });
  const mayorRef = useRef(0);

  // El mundo vive en JavaScript (lib/caida.js) y el hilo de la interfaz sólo
  // DIBUJA una foto compacta que se le pasa en cada cuadro. Hasta la build 94
  // la física corría en el hilo de la interfaz (`mundo.modify` dentro de
  // `useFrameCallback`) y el juego se cerraba al iniciarlo: un error ahí no se
  // puede atrapar y tumba la app entera. Éste es el patrón del Botiquín
  // anterior —lógica en JavaScript, sólo el cuadro en el otro hilo—, que nunca
  // se cayó. El costo de cruzar la foto es chico: 5 números por pieza.
  const mundo = useRef(null);
  const foto = useSharedValue(null);
  const geoV = useSharedValue(null);
  const imgs = useSharedValue(null);
  const apunta = useSharedValue(0.5); // dónde se va a soltar, en anchos
  const enJuego = useSharedValue(false);
  const enJuegoRef = useRef(false);
  const animar = useSharedValue(!quieta);
  const animarRef = useRef(!quieta);
  useEffect(() => { animar.value = !quieta; animarRef.current = !quieta; }, [quieta, animar]);

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE_RECORD).then((v) => { const n = Number(v) || 0; recordRef.current = n; setRecord(n); }).catch(() => {});
    SecureStore.getItemAsync(CLAVE_MAYOR).then((v) => { if (v != null && v !== '') { const n = Number(v); if (Number.isFinite(n)) { mayorHistRef.current = n; setMayorHistorico(n); } } }).catch(() => {});
    return () => callar(SONIDOS);
  }, []);

  const chicas = useMemo(() => hornearPiezas(22), []); // diámetro ~44 para la portada
  const geo = useMemo(() => (caja ? medir(caja.w, caja.h) : null), [caja]);
  useEffect(() => {
    if (!geo) return;
    const s = hornearPiezas(geo.S);
    if (!s) return;
    geoV.value = geo;
    imgs.value = { ...s, caja: grabarBotiquin(geo) };
  }, [geo, geoV, imgs]);

  // ── Lo que JavaScript hace cuando el mundo avisa (sonido, vibración, marcador)
  const js = useRef({});
  js.current.soltada = (n, a, s, total) => {
    setActual(a); setSiguiente(s); setCuantas(total);
    sonar('gota', { volumen: 0.45, tono: 1.25 - n * 0.06 });
    tacto.roce();
  };
  js.current.eventos = (evs, pts, total) => {
    setPuntos(pts); setCuantas(total);
    const ahora = Date.now();
    for (const e of evs) {
      racha.current = ahora - racha.current.t < 900 ? { n: racha.current.n + 1, t: ahora } : { n: 1, t: ahora };
      if (e.tipo === 'cumbre') {
        sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1);
        setAviso({ k: ahora, texto: `¡Dos cruces! +${PREMIO_CUMBRE}` });
        continue;
      }
      sonar(`pop-${1 + (e.n % 6)}`, { tono: Math.max(0.7, 1.2 - e.n * 0.05), volumen: 0.8 });
      if (e.n >= 5) tacto.golpe(); else tacto.toque();
      if (e.n > mayorRef.current) {
        mayorRef.current = e.n; setMayor(e.n);
        if (e.n >= 4) { sonar('par', { volumen: 0.6 }); setAviso({ k: ahora, texto: `¡Hiciste ${ARTICULO[e.n] === 'el' ? 'tu primer' : 'tu primera'} ${NOMBRES[e.n]}!` }); }
      }
      if (racha.current.n >= 3) setAviso({ k: ahora + 1, texto: `¡Cadena ×${racha.current.n}!` });
    }
  };
  js.current.peligro = (si) => {
    if (si) { sonar('fallo', { volumen: 0.5 }); tacto.aviso(); setAviso({ k: Date.now(), texto: '¡Se desborda!' }); } else setAviso(null);
  };
  js.current.perder = (pts, may) => {
    enJuego.value = false;
    setPuntos(pts); setFase('fin'); setAviso(null);
    sonar('derrumbe'); tacto.aviso();
    if (may > mayorHistRef.current) { mayorHistRef.current = may; setMayorHistorico(may); SecureStore.setItemAsync(CLAVE_MAYOR, String(may)).catch(() => {}); }
    if (pts > recordRef.current) {
      recordRef.current = pts; setRecord(pts); setNuevoRecord(true);
      SecureStore.setItemAsync(CLAVE_RECORD, String(pts)).catch(() => {});
      setTimeout(() => { sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1); }, 600);
    }
  };
  const mostrar = (cuelga) => { if (mundo.current) foto.value = fotografiar(mundo.current, animarRef.current, cuelga); };

  // ── El reloj: requestAnimationFrame, pasos fijos (lib/caida.js) ─────────────
  const cuadroJs = useRef(null);
  cuadroJs.current = (dt) => {
    const m = mundo.current;
    if (!m || m.perdio) return;
    avanzar(m, dt);
    if (m.eventos.length) { const evs = m.eventos; m.eventos = []; js.current.eventos(evs, m.puntos, m.cuerpos.length); }
    if (!m.alerta && m.peligro > 0.4) { m.alerta = true; js.current.peligro(true); } else if (m.alerta && m.peligro === 0) { m.alerta = false; js.current.peligro(false); }
    mostrar(!m.perdio);
    if (m.perdio) js.current.perder(m.puntos, m.mayor);
  };
  const corriendo = fase === 'jugando' && !pausa && visible && !!geo;
  useEffect(() => {
    enJuegoRef.current = corriendo; enJuego.value = corriendo;
    if (!corriendo) return undefined;
    let id = 0; let antes = 0; let vivo = true;
    const tic = (ahora) => {
      if (!vivo) return;
      const dt = antes ? (ahora - antes) / 1000 : 1 / 60;
      antes = ahora;
      try { cuadroJs.current(dt); } catch (err) {
        // Una falla del motor termina la partida; nunca cierra la app.
        reportarError(err, { pantalla: 'botiquin' });
        enJuegoRef.current = false; enJuego.value = false;
        setFase('fin');
        return;
      }
      id = requestAnimationFrame(tic);
    };
    id = requestAnimationFrame(tic);
    return () => { vivo = false; cancelAnimationFrame(id); };
  }, [corriendo, enJuego]);
  // Si la pantalla deja de verse a media partida, queda en pausa al volver.
  useEffect(() => { if (!visible && fase === 'jugando') setPausa(true); }, [visible, fase]);

  const empezar = useCallback(() => {
    const semilla = (Date.now() % 2147483000) + 1;
    setPuntos(0); setMayor(0); mayorRef.current = 0; setCuantas(0); setNuevoRecord(false); setAviso(null); setPausa(false);
    racha.current = { n: 0, t: 0 };
    const m = crearMundo(ALTO, semilla);
    m.alerta = false;
    mundo.current = m;
    apunta.value = 0.5;
    foto.value = fotografiar(m, animarRef.current, true);
    setActual(m.actual); setSiguiente(m.siguiente);
    setFase('jugando');
  }, [apunta, foto]);

  // Soltar: el dedo se lee en el hilo de la interfaz; la pieza la suelta el mundo.
  js.current.soltarEn = (x) => {
    const m = mundo.current;
    if (!enJuegoRef.current || !m) return;
    const b = soltar(m, x);
    if (b) { js.current.soltada(b.n, m.actual, m.siguiente, m.cuerpos.length); mostrar(true); }
  };
  const alSoltarEn = useCallback((x) => js.current.soltarEn(x), []);

  const aAnchos = (px) => { 'worklet'; const g = geoV.value; return g ? Math.min(1, Math.max(0, (px - g.ox) / g.S)) : 0.5; };
  const gesto = useMemo(() => Gesture.Pan().minDistance(0).maxPointers(1)
    .onBegin((e) => { apunta.value = aAnchos(e.x); })
    .onUpdate((e) => { apunta.value = aAnchos(e.x); })
    // Se suelta al levantar el dedo, haya arrastrado o sólo tocado (un toque
    // corto puede no llegar a «activar» el arrastre: por eso no se mira `ok`).
    .onFinalize((e) => { const v = aAnchos(e.x); apunta.value = v; runOnJS(alSoltarEn)(v); }), [apunta, alSoltarEn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── El cuadro: un solo Picture con todo ─────────────────────────────────────
  const cuadro = useDerivedValue(() => {
    const g = geoV.value; const im = imgs.value; const f = foto.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.W : 1, g ? g.H : 1));
    if (!g || !im) return rec.finishRecordingAsPicture();
    c.drawPicture(im.caja);
    if (!f) return rec.finishRecordingAsPicture();
    const S = g.S; const t = f.t; const mov = animar.value;
    const p = Skia.Paint(); p.setAntiAlias(true);
    const X = (x) => g.ox + x * S; const Y = (y) => g.oy + y * S;
    const estampa = (n, x, y, ang, esc) => {
      const r = RADIOS[n] * S * esc;
      c.save(); c.translate(X(x), Y(y));
      if (ang) c.rotate((ang * 180) / Math.PI, 0, 0);
      c.drawImageRect(im.piezas[n], im.src[n], Skia.XYWHRect(-r, -r, r * 2, r * 2), p);
      c.restore();
    };

    // El borde: punteado, y en rojo que late mientras algo se desborda.
    const linea = Skia.Paint(); linea.setAntiAlias(true);
    if (f.peligro > 0) {
      linea.setColor(Skia.Color(PELIGRO));
      linea.setAlphaf(mov ? 0.55 + 0.45 * Math.sin(t * 14) : 1);
    } else { linea.setColor(Skia.Color('#FFFFFF')); linea.setAlphaf(0.32); }
    const seg = S * 0.035;
    for (let x = 0; x < S; x += seg * 2) c.drawRect(Skia.XYWHRect(g.ox + x, g.oy - 1, Math.min(seg, S - x), 2), linea);

    // La pieza que cuelga y su guía hasta el fondo.
    if (enJuego.value && f.cuelga) {
      const n = f.actual; const r = RADIOS[n];
      const x = Math.min(1 - r, Math.max(r, apunta.value));
      const guia = Skia.Paint(); guia.setColor(Skia.Color('#FFFFFF')); guia.setAlphaf(f.lista ? 0.2 : 0.08);
      c.drawRect(Skia.XYWHRect(X(x) - 0.75, Y(ALTURA_SOLTAR + r), 1.5, Y(ALTO) - Y(ALTURA_SOLTAR + r)), guia);
      if (f.lista) estampa(n, x, ALTURA_SOLTAR, 0, 1);
    }

    const cs = f.c;
    for (let i = 0; i < cs.length; i += 5) estampa(cs[i], cs[i + 1], cs[i + 2], cs[i + 3], cs[i + 4]);

    // El anillo de cada unión: se abre y se apaga (no llega con «reducir movimiento»).
    const an = f.a;
    if (an.length) {
      const aro = Skia.Paint(); aro.setAntiAlias(true); aro.setStyle(PaintStyle.Stroke);
      for (let i = 0; i < an.length; i += 5) {
        const ax = an[i]; const ay = an[i + 1]; const ar = an[i + 2]; const nn = an[i + 3]; const q = an[i + 4];
        aro.setColor(Skia.Color(nn === MAX ? ORO : '#FFFFFF'));
        aro.setAlphaf((1 - q) * 0.85);
        aro.setStrokeWidth(1 + 3 * (1 - q));
        c.drawCircle(X(ax), Y(ay), ar * S * (1 + 0.55 * q), aro);
        aro.setStrokeWidth(2.5 * (1 - q));
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + nn;
          const d = ar * S * (1.05 + 0.9 * q);
          c.drawPoint(X(ax) + Math.cos(ang) * d, Y(ay) + Math.sin(ang) * d, aro);
        }
      }
    }
    return rec.finishRecordingAsPicture();
  });

  const jugando = fase === 'jugando';
  const acciones = [
    { name: 'izquierda', label: 'Soltar a la izquierda' },
    { name: 'centro', label: 'Soltar al centro' },
    { name: 'derecha', label: 'Soltar a la derecha' },
  ];
  const alAccion = (e) => {
    const x = { izquierda: 0.15, centro: 0.5, derecha: 0.85, activate: 0.5 }[e.nativeEvent.actionName];
    if (x == null) return;
    apunta.value = x;
    js.current.soltarEn(x);
  };

  return (
    <Escena colores={ESCENAS.botiquin} fijo estilo={{ gap: 10 }}>
      <ControlesSensaciones izquierda={<>
        <Marcador sf="star.fill" texto={entero(puntos)} etiqueta={`${entero(puntos)} puntos`} />
        <Marcador sf="trophy.fill" texto={entero(record)} etiqueta={`Récord: ${entero(record)} puntos`} />
        {jugando && !pausa ? <BotonChico sf="pause.fill" etiqueta="Pausar" alTocar={() => setPausa(true)} /> : null}
      </>} />

      {jugando ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 40 }}>
          <View style={{ flexShrink: 1 }}>
            <AvisoJuego clave={aviso?.k} texto={aviso?.texto} />
          </View>
          <View style={estilos.sigue} accessible accessibilityLabel={`Ahora cae: ${NOMBRES[actual]}. Después: ${NOMBRES[siguiente]}.`}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '800', color: BLANCO_2 }}>Sigue</Text>
            <PiezaChica chicas={chicas} nivel={siguiente} tam={30} />
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1 }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (!caja || caja.w !== w || caja.h !== h) setCaja({ w, h }); }}>
        {geo && fase !== 'portada' ? (
          <GestureDetector gesture={gesto}>
            <View style={{ flex: 1 }} accessible
              accessibilityLabel={`Botiquín con ${cuantas} ${cuantas === 1 ? 'pieza' : 'piezas'}. ${entero(puntos)} puntos. Ahora cae: ${NOMBRES[actual]}. Arrastra a los lados y suelta para dejarla caer.`}
              accessibilityActions={jugando && !pausa ? acciones : []} onAccessibilityAction={alAccion}>
              <Canvas style={{ flex: 1 }}>
                <Picture picture={cuadro} />
              </Canvas>
            </View>
          </GestureDetector>
        ) : null}

        {fase === 'portada' ? (
          <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
            <PanelVidrio estilo={{ gap: 12 }}>
              <Text style={{ fontSize: 24, fontWeight: '900', color: BLANCO, textAlign: 'center' }}>Botiquín</Text>
              <Text style={{ ...textoAyuda, textAlign: 'center' }}>
                Arrastra a los lados y suelta: el medicamento cae al botiquín. Dos iguales que se tocan se juntan en el siguiente. ¡Llega a la cruz de farmacia! Si algo se queda asomado sobre el borde, se acaba.
              </Text>
              <Cadena chicas={chicas} mayor={mayorHistorico} />
            </PanelVidrio>
            <BotonJuego sf="play.fill" alTocar={empezar}>Jugar</BotonJuego>
          </Animated.View>
        ) : null}

        {jugando && pausa ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={estilos.encima}>
            <TarjetaNivel titulo="En pausa" texto={`Llevas ${entero(puntos)} puntos.`}>
              <BotonJuego sf="play.fill" alTocar={() => setPausa(false)}>Seguir</BotonJuego>
              <BotonJuego secundario sf="arrow.clockwise" alTocar={empezar}>Empezar de nuevo</BotonJuego>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {fase === 'fin' ? (
          <Animated.View entering={FadeIn.delay(500).duration(400)} style={estilos.encima}>
            <TarjetaNivel insignia={nuevoRecord ? '¡NUEVO RÉCORD!' : null} titulo={`${entero(puntos)} puntos`}
              texto={`${nuevoRecord ? 'Tu mejor partida hasta ahora.' : `Tu récord es de ${entero(record)}.`} Tu pieza más grande: ${NOMBRES[mayor]}.`}>
              <Cadena chicas={chicas} mayor={mayor} />
              <BotonJuego sf="arrow.clockwise" alTocar={empezar}>Jugar otra vez</BotonJuego>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', ORO, VERDE, '#F6C9EF']} alTerminar={() => {}} /> : null}
      </View>
    </Escena>
  );
}

const estilos = StyleSheet.create({
  redondo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  sigue: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 5, minHeight: 40, borderRadius: 20, backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  encima: { position: 'absolute', left: 0, right: 0, bottom: 8 },
});
