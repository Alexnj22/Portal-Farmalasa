// Botiquín (Bienestar, 2026-11-04). Pedido del usuario: «agreguemos un juego
// que he visto de unir objetos del mismo tipo, y se van transformando en otros,
// que sean de cosas médicas y salud» · «muy visual, moderno, entretenido» ·
// «pensado tanto para niños como para adultos». Juego propio: nombre, dibujos y
// niveles son nuestros.
//
// Se arrastra una pieza sobre otra IGUAL que esté a su lado (también en
// diagonal) y las dos se vuelven la siguiente de la cadena:
//   Gota → Pastilla → Cápsula → Jarabe → Curita → Termómetro → Estetoscopio
//   → Botiquín → Corazón sano.
// Dos corazones sanos juntos se van con una lluvia dorada y dejan espacio.
// Arrastrar a un hueco mueve la pieza. Cada jugada trae una pieza nueva; si el
// tablero se llena sin parejas al lado, se acabó.
//
// Niveles: cada uno pide crear algo («Crea 2 Curitas») y a veces romper cajas
// (una caja se rompe al unir una pareja junto a ella), con un tope de
// movimientos; las estrellas salen de los movimientos que sobran. Los tableros
// crecen a 6×6, las metas suben por la cadena y los topes se aprietan. «Relax»
// no tiene tope: sólo puntos y récord.
//
// Rendimiento (la lección de Burbujas y Torre): cada pieza se dibuja UNA vez
// como imagen (Skia.Surface, a la densidad del teléfono) y el tablero es un solo
// `Picture` que las estampa, armado en el hilo de la interfaz. El arrastre, la
// pieza bajo el dedo, la unión y la pieza nueva se deciden ahí mismo, en el
// gesto: JavaScript sólo se entera al soltar (sonido, vibración, metas). El
// «respirar» de las piezas quietas va a 30 cuadros con un solo reloj, y con
// «reducir movimiento» se queda quieto.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  BlurStyle, Canvas, ClipOp, FilterMode, Image as ImagenSkia, MipmapMode, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, TileMode,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, ZoomIn, runOnJS, runOnUI, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { Confeti, Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import {
  AvisoJuego, BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio, VIDRIO, VIDRIO_BORDE, textoAyuda,
} from '../componentes/juegos/Escena';
import { entero } from '../lib/formato';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const CLAVE_NIVEL = 'puntos_salud_botiquin_nivel'; // el nivel más alto abierto
const CLAVE_RECORD = 'puntos_salud_botiquin_record'; // puntos de Relax
const CLAVE_ESTRELLAS = 'puntos_salud_botiquin_estrellas'; // { "1": 3, "2": 2, … }
const SONIDOS = ['pop-2', 'pop-3', 'pop-5', 'par', 'ganar', 'fallo', 'gota', 'bloque', 'toque-1', 'toque-2', 'toque-3', 'toque-4', 'toque-5', 'toque-6'];

const MAX = 9; // el corazón sano
const CAJA = -1;
const NOMBRES = [null, 'Gota', 'Pastilla', 'Cápsula', 'Jarabe', 'Curita', 'Termómetro', 'Estetoscopio', 'Botiquín', 'Corazón sano'];
const PLURAL = [null, 'Gotas', 'Pastillas', 'Cápsulas', 'Jarabes', 'Curitas', 'Termómetros', 'Estetoscopios', 'Botiquines', 'Corazones sanos'];
const ARTICULO = [null, 'una', 'una', 'una', 'un', 'una', 'un', 'un', 'un', 'un'];
// Cada pieza tiene forma Y color propios (se distinguen también sin ver colores).
const COLORES = [
  null,
  ['#A6E4FF', '#2F8FE6'], // gota · celeste
  ['#E2D2FF', '#8862EC'], // pastilla · lila
  ['#FFC6E6', '#DD4398'], // cápsula · rosa
  ['#FFDDB0', '#EC7A2E'], // jarabe · durazno
  ['#C2F5DC', '#20A97E'], // curita · menta
  ['#C3CEFF', '#4B5DDC'], // termómetro · índigo
  ['#FFBCC2', '#DC3C4B'], // estetoscopio · coral
  ['#FFAEE7', '#BE168B'], // botiquín · magenta de la marca
  ['#9B47D0', '#3B0D61'], // corazón · violeta profundo con oro
];
const TONO_CAJA = ['#EDCB9C', '#AE7742'];
const CHISPA_COLOR = [null, '#7FD3FF', '#B89CFF', '#FF8CC8', '#FFB070', '#6FE3B4', '#8C9CFF', '#FF8A94', '#FF7AD6', '#FFD45C', '#E2B27A'];
const PUNTOS = [0, 0, 5, 10, 20, 40, 80, 160, 320, 640];

// Tiempos de las animaciones (segundos).
const LEVANTA = 0.12;
const JUNTA = 0.1; // las dos piezas se acercan
const POP = 0.42; // la nueva estira y encoge
const NACE = 0.34;
const VUELTA = 0.28; // regresa a su casilla si no se podía soltar ahí
const ROMPE = 0.32;
const CHISPA = 0.6;

// Los niveles. `meta`: qué pieza crear; `cuantas`; `cajas`: cuántas hay (y hay
// que romperlas todas); `movs`: tope; `inicio`: piezas al empezar; `p2`:
// probabilidad de que la pieza nueva ya sea una pastilla.
const NIVELES = [
  { C: 5, meta: 4, cuantas: 1, cajas: 0, movs: 14, inicio: 8, p2: 0.25 },
  { C: 5, meta: 4, cuantas: 2, cajas: 0, movs: 22, inicio: 9, p2: 0.25 },
  { C: 5, meta: 5, cuantas: 1, cajas: 0, movs: 24, inicio: 9, p2: 0.25 },
  { C: 5, meta: 5, cuantas: 1, cajas: 3, movs: 28, inicio: 8, p2: 0.22 },
  { C: 5, meta: 5, cuantas: 2, cajas: 2, movs: 42, inicio: 9, p2: 0.2 },
  { C: 6, meta: 6, cuantas: 1, cajas: 4, movs: 44, inicio: 11, p2: 0.2 },
  { C: 6, meta: 6, cuantas: 2, cajas: 4, movs: 72, inicio: 12, p2: 0.2 },
  { C: 6, meta: 7, cuantas: 1, cajas: 5, movs: 76, inicio: 12, p2: 0.2 },
  { C: 6, meta: 7, cuantas: 1, cajas: 7, movs: 68, inicio: 12, p2: 0.18 },
  { C: 6, meta: 8, cuantas: 1, cajas: 5, movs: 140, inicio: 13, p2: 0.2 },
  { C: 6, meta: 8, cuantas: 1, cajas: 8, movs: 130, inicio: 13, p2: 0.18 },
  { C: 6, meta: 9, cuantas: 1, cajas: 6, movs: 270, inicio: 14, p2: 0.2 },
];
// Después del 12 se repiten los tres últimos, cada vuelta más apretados.
function nivelDe(n) {
  if (n <= NIVELES.length) return NIVELES[n - 1];
  const extra = n - NIVELES.length - 1;
  const vuelta = 1 + Math.floor(extra / 3);
  const base = NIVELES[NIVELES.length - 3 + (extra % 3)];
  return { ...base, movs: Math.round(base.movs * Math.max(0.7, 1 - 0.05 * vuelta)), cajas: Math.min(10, base.cajas + vuelta) };
}
const RELAX = { C: 6, meta: 0, cuantas: 0, cajas: 0, movs: 0, inicio: 10, p2: 0.2 };
const MODOS = [{ valor: 'niveles', texto: 'Niveles' }, { valor: 'relax', texto: 'Relax', detalle: 'sin límite' }];

function textoMeta(conf) {
  const partes = [conf.cuantas === 1 ? `Crea ${ARTICULO[conf.meta]} ${NOMBRES[conf.meta]}` : `Crea ${conf.cuantas} ${PLURAL[conf.meta]}`];
  if (conf.cajas) partes.push(conf.cajas === 1 ? 'rompe la caja' : `rompe las ${conf.cajas} cajas`);
  return partes.join(' y ');
}
const estrellasDe = (sobran, movs) => (sobran / movs >= 0.35 ? 3 : sobran / movs >= 0.15 ? 2 : 1);

// ── Lógica del tablero: funciones de hilo de la interfaz (y de JS) ─────────────
function vecinas(o, d, C) {
  'worklet';
  if (o === d) return false;
  return Math.abs((o % C) - (d % C)) <= 1 && Math.abs(Math.floor(o / C) - Math.floor(d / C)) <= 1;
}
function hayPareja(b, C) {
  'worklet';
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (v <= 0) continue;
    const c = i % C; const f = Math.floor(i / C);
    if (c + 1 < C && b[i + 1] === v) return true;
    if (f + 1 < C && b[i + C] === v) return true;
    if (f + 1 < C && c + 1 < C && b[i + C + 1] === v) return true;
    if (f + 1 < C && c > 0 && b[i + C - 1] === v) return true;
  }
  return false;
}
function buscarPareja(b, C) {
  'worklet';
  for (let i = 0; i < b.length; i++) {
    if (b[i] <= 0) continue;
    for (let j = 0; j < b.length; j++) if (b[j] === b[i] && vecinas(i, j, C)) return [i, j];
  }
  return null;
}
function celdaDe(g, x, y) {
  'worklet';
  const col = Math.floor((x - g.x0) / g.celda);
  const fila = Math.floor((y - g.y0) / g.celda);
  if (col < 0 || col >= g.C || fila < 0 || fila >= g.C) return -1;
  return fila * g.C + col;
}
const centroX = (g, i) => { 'worklet'; return g.x0 + ((i % g.C) + 0.5) * g.celda; };
const centroY = (g, i) => { 'worklet'; return g.y0 + (Math.floor(i / g.C) + 0.5) * g.celda; };
// `rr` para el hilo de la interfaz (las del horneado corren en JavaScript).
const rrw = (x, y, w, h, r) => { 'worklet'; return Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r); };
const saltito = (k) => { 'worklet'; const s = 1.7; const u = k - 1; return 1 + (s + 1) * u * u * u + s * u * u; };

function tableroInicial(conf) {
  const N = conf.C * conf.C;
  for (let intento = 0; intento < 60; intento++) {
    const b = new Array(N).fill(0);
    const libres = () => b.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k < conf.cajas; k++) { const l = libres(); b[l[Math.floor(Math.random() * l.length)]] = CAJA; }
    for (let k = 0; k < conf.inicio; k++) { const l = libres(); b[l[Math.floor(Math.random() * l.length)]] = Math.random() < 0.3 ? 2 : 1; }
    // Al menos dos parejas a la mano, y cada caja con espacio al lado para romperla.
    let parejas = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (b[i] > 0 && b[i] === b[j] && vecinas(i, j, conf.C)) parejas++;
    if (parejas >= 2) return b;
  }
  const b = new Array(N).fill(0); b[0] = 1; b[1] = 1; b[conf.C] = 2; b[conf.C + 1] = 2;
  return b;
}

// ── Los dibujos ──────────────────────────────────────────────────────────────
const col = (c) => Skia.Color(c);
const rr = (x, y, w, h, r) => Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r);
const lineal = (x0, y0, x1, y1, cs, pos = null) => Skia.Shader.MakeLinearGradient(Skia.Point(x0, y0), Skia.Point(x1, y1), cs.map(col), pos, TileMode.Clamp);
function pincel(color) { const p = Skia.Paint(); p.setAntiAlias(true); p.setColor(col(color)); return p; }
function trazo(color, ancho) {
  const p = pincel(color); p.setStyle(PaintStyle.Stroke); p.setStrokeWidth(ancho);
  p.setStrokeCap(StrokeCap.Round); p.setStrokeJoin(StrokeJoin.Round); return p;
}
function degradado(x0, y0, x1, y1, cs) { const p = Skia.Paint(); p.setAntiAlias(true); p.setShader(lineal(x0, y0, x1, y1, cs)); return p; }

// Una carita discreta (gota, pastilla, corazón): dos puntos y una sonrisa.
function carita(c, x, y, k, color) {
  const ojo = pincel(color);
  c.drawCircle(x - k * 0.11, y, k * 0.035, ojo);
  c.drawCircle(x + k * 0.11, y, k * 0.035, ojo);
  const boca = Skia.Path.Make();
  boca.moveTo(x - k * 0.07, y + k * 0.07);
  boca.quadTo(x, y + k * 0.13, x + k * 0.07, y + k * 0.07);
  c.drawPath(boca, trazo(color, k * 0.03));
}
function destello(c, x, y, r, color) {
  const e = Skia.Path.Make(); const q = r * 0.22;
  e.moveTo(x, y - r); e.lineTo(x + q, y - q); e.lineTo(x + r, y); e.lineTo(x + q, y + q);
  e.lineTo(x, y + r); e.lineTo(x - q, y + q); e.lineTo(x - r, y); e.lineTo(x - q, y - q); e.close();
  c.drawPath(e, pincel(color));
}

// Dibuja el ícono de una pieza dentro de un cuadro de lado k centrado en (m, n).
function icono(c, tier, m, n, k, fuerte) {
  switch (tier) {
    case 1: { // Gota de agua
      const r = k * 0.3; const cy = n + k * 0.12; const ty = n - k * 0.42;
      const p = Skia.Path.Make();
      p.moveTo(m, ty);
      p.cubicTo(m + r * 0.45, ty + r * 0.85, m + r, cy - r * 0.55, m + r, cy);
      p.cubicTo(m + r, cy + r * 0.552, m + r * 0.552, cy + r, m, cy + r);
      p.cubicTo(m - r * 0.552, cy + r, m - r, cy + r * 0.552, m - r, cy);
      p.cubicTo(m - r, cy - r * 0.55, m - r * 0.45, ty + r * 0.85, m, ty);
      p.close();
      c.drawPath(p, degradado(m, ty, m, cy + r, ['#FFFFFF', '#D8F2FF']));
      c.drawOval(Skia.XYWHRect(m - r * 0.62, cy - r * 0.62, r * 0.3, r * 0.5), pincel('rgba(255,255,255,0.95)'));
      carita(c, m, cy + r * 0.05, k, fuerte);
      break;
    }
    case 2: { // Pastilla redonda con su ranura
      const r = k * 0.36;
      c.drawCircle(m, n + k * 0.03, r, pincel('rgba(60,20,120,0.25)'));
      c.drawCircle(m, n, r, degradado(m - r, n - r, m + r, n + r, ['#FFFFFF', '#E9E0FF']));
      c.drawCircle(m, n, r * 0.8, trazo('rgba(136,98,236,0.25)', k * 0.025));
      c.save(); c.rotate(-30, m, n);
      c.drawLine(m - r * 0.62, n - r * 0.45, m + r * 0.62, n - r * 0.45, trazo('rgba(136,98,236,0.45)', k * 0.04));
      c.restore();
      carita(c, m, n + r * 0.12, k, fuerte);
      break;
    }
    case 3: { // Cápsula de dos colores
      const w = k * 0.98; const h = k * 0.42;
      c.save(); c.rotate(-40, m, n);
      c.drawRRect(rr(m - w / 2, n - h / 2 + k * 0.03, w, h, h / 2), pincel('rgba(90,0,50,0.25)'));
      c.drawRRect(rr(m - w / 2, n - h / 2, w, h, h / 2), degradado(0, n - h / 2, 0, n + h / 2, ['#FFFFFF', '#F3E8EE']));
      c.save(); c.clipRect(Skia.XYWHRect(m, n - h, w, h * 2), ClipOp.Intersect, true);
      c.drawRRect(rr(m - w / 2, n - h / 2, w, h, h / 2), degradado(0, n - h / 2, 0, n + h / 2, ['#FF7DBF', '#C21F7A']));
      c.restore();
      c.drawLine(m, n - h / 2 + 1, m, n + h / 2 - 1, trazo('rgba(120,0,60,0.25)', k * 0.025));
      c.drawRRect(rr(m - w * 0.38, n - h * 0.32, w * 0.76, h * 0.18, h * 0.09), pincel('rgba(255,255,255,0.75)'));
      c.restore();
      break;
    }
    case 4: { // Frasco de jarabe con etiqueta
      const bx = m - k * 0.3; const by = n - k * 0.12; const bw = k * 0.6; const bh = k * 0.56;
      c.drawRRect(rr(m - k * 0.12, n - k * 0.27, k * 0.24, k * 0.2, k * 0.04), pincel('#FFF6EC'));
      c.drawRRect(rr(m - k * 0.17, n - k * 0.44, k * 0.34, k * 0.18, k * 0.06), degradado(0, n - k * 0.44, 0, n - k * 0.26, ['#FF9A52', '#C2541A']));
      c.drawRRect(rr(bx, by, bw, bh, k * 0.13), pincel('rgba(255,250,244,0.96)'));
      c.save(); c.clipRRect(rr(bx, by, bw, bh, k * 0.13), ClipOp.Intersect, true);
      c.drawRect(Skia.XYWHRect(bx, by + bh * 0.42, bw, bh), degradado(0, by + bh * 0.42, 0, by + bh, ['#FFA24C', '#D9531A']));
      c.restore();
      c.drawRRect(rr(m - k * 0.2, by + bh * 0.2, k * 0.4, bh * 0.36, k * 0.05), pincel('#FFFFFF'));
      const cr = pincel(fuerte); const g = k * 0.045;
      c.drawRect(Skia.XYWHRect(m - g, by + bh * 0.25, g * 2, bh * 0.26), cr);
      c.drawRect(Skia.XYWHRect(m - bh * 0.13, by + bh * 0.38 - g, bh * 0.26, g * 2), cr);
      c.drawRRect(rr(bx + bw * 0.1, by + bh * 0.1, bw * 0.12, bh * 0.7, bw * 0.06), pincel('rgba(255,255,255,0.6)'));
      break;
    }
    case 5: { // Curita
      const w = k * 1.02; const h = k * 0.38;
      c.save(); c.rotate(-35, m, n);
      c.drawRRect(rr(m - w / 2, n - h / 2 + k * 0.03, w, h, h / 2), pincel('rgba(0,70,50,0.25)'));
      c.drawRRect(rr(m - w / 2, n - h / 2, w, h, h / 2), degradado(0, n - h / 2, 0, n + h / 2, ['#FFE9D2', '#F2C79C']));
      c.drawRRect(rr(m - w * 0.17, n - h * 0.36, w * 0.34, h * 0.72, h * 0.12), pincel('#FFF8F0'));
      const hoyo = pincel('rgba(180,120,70,0.45)');
      for (const dx of [-0.34, -0.27, 0.27, 0.34]) for (const dy of [-0.14, 0.14]) c.drawCircle(m + w * dx, n + h * dy, k * 0.022, hoyo);
      c.drawRRect(rr(m - w * 0.4, n - h * 0.38, w * 0.8, h * 0.16, h * 0.08), pincel('rgba(255,255,255,0.55)'));
      c.restore();
      break;
    }
    case 6: { // Termómetro
      c.save(); c.rotate(35, m, n);
      const tw = k * 0.22; const ty = n - k * 0.46; const th = k * 0.72;
      c.drawRRect(rr(m - tw / 2, ty, tw, th, tw / 2), pincel('#FFFFFF'));
      c.drawCircle(m, n + k * 0.3, k * 0.17, pincel('#FFFFFF'));
      c.drawCircle(m, n + k * 0.3, k * 0.12, degradado(m, n + k * 0.18, m, n + k * 0.42, ['#FF6B6B', '#D61F35']));
      c.drawRRect(rr(m - tw * 0.2, n - k * 0.12, tw * 0.4, k * 0.44, tw * 0.2), pincel('#E8323F'));
      const raya = trazo('rgba(75,93,220,0.45)', k * 0.025);
      for (let j = 0; j < 4; j++) c.drawLine(m + tw * 0.12, ty + k * (0.1 + j * 0.09), m + tw * 0.38, ty + k * (0.1 + j * 0.09), raya);
      c.drawRRect(rr(m - tw * 0.38, ty + tw * 0.3, tw * 0.16, th * 0.5, tw * 0.08), pincel('rgba(200,210,255,0.8)'));
      c.restore();
      break;
    }
    case 7: { // Estetoscopio
      const t = trazo('#FFFFFF', k * 0.085);
      const u = Skia.Path.Make();
      u.moveTo(m - k * 0.32, n - k * 0.38);
      u.cubicTo(m - k * 0.32, n + k * 0.04, m + k * 0.16, n + k * 0.04, m + k * 0.16, n - k * 0.38);
      c.drawPath(u, t);
      const tubo = Skia.Path.Make();
      tubo.moveTo(m - k * 0.08, n - k * 0.07);
      tubo.cubicTo(m - k * 0.08, n + k * 0.42, m + k * 0.3, n + k * 0.42, m + k * 0.3, n + k * 0.16);
      c.drawPath(tubo, t);
      const tapa = pincel('#FFFFFF');
      c.drawCircle(m - k * 0.32, n - k * 0.4, k * 0.06, tapa);
      c.drawCircle(m + k * 0.16, n - k * 0.4, k * 0.06, tapa);
      c.drawCircle(m + k * 0.3, n + k * 0.07, k * 0.15, tapa);
      c.drawCircle(m + k * 0.3, n + k * 0.07, k * 0.09, degradado(m + k * 0.2, n, m + k * 0.4, n + k * 0.16, ['#8C9CFF', '#3346B8']));
      c.drawCircle(m + k * 0.27, n + k * 0.04, k * 0.03, pincel('rgba(255,255,255,0.9)'));
      break;
    }
    case 8: { // Botiquín
      c.drawRRect(rr(m - k * 0.17, n - k * 0.37, k * 0.34, k * 0.22, k * 0.07), trazo('#FFFFFF', k * 0.07));
      const by = n - k * 0.2; const bh = k * 0.6;
      c.drawRRect(rr(m - k * 0.44, by + k * 0.03, k * 0.88, bh, k * 0.12), pincel('rgba(90,0,60,0.25)'));
      c.drawRRect(rr(m - k * 0.44, by, k * 0.88, bh, k * 0.12), degradado(0, by, 0, by + bh, ['#FFFFFF', '#FBE3F2']));
      c.drawRect(Skia.XYWHRect(m - k * 0.44, by + bh * 0.16, k * 0.88, k * 0.03), pincel('rgba(190,22,139,0.18)'));
      const cy = by + bh * 0.56; const g = k * 0.075; const L = k * 0.2;
      const cruz = pincel(fuerte);
      c.drawRRect(rr(m - g, cy - L, g * 2, L * 2, g * 0.5), cruz);
      c.drawRRect(rr(m - L, cy - g, L * 2, g * 2, g * 0.5), cruz);
      break;
    }
    case 9: { // Corazón sano, dorado, con su latido
      const p = Skia.Path.Make();
      p.moveTo(m, n + k * 0.38);
      p.cubicTo(m - k * 0.6, n + k * 0.0, m - k * 0.44, n - k * 0.46, m, n - k * 0.2);
      p.cubicTo(m + k * 0.44, n - k * 0.46, m + k * 0.6, n + k * 0.0, m, n + k * 0.38);
      p.close();
      const brillo = pincel('rgba(255,214,90,0.35)');
      brillo.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, k * 0.08, true));
      c.drawPath(p, brillo);
      c.drawPath(p, degradado(m, n - k * 0.4, m, n + k * 0.4, ['#FFF7BF', '#FFC928', '#E58E00']));
      c.drawPath(p, trazo('rgba(255,255,255,0.7)', k * 0.025));
      const ecg = Skia.Path.Make();
      ecg.moveTo(m - k * 0.3, n + k * 0.02); ecg.lineTo(m - k * 0.12, n + k * 0.02); ecg.lineTo(m - k * 0.06, n - k * 0.12);
      ecg.lineTo(m + k * 0.03, n + k * 0.14); ecg.lineTo(m + k * 0.09, n - k * 0.02); ecg.lineTo(m + k * 0.3, n - k * 0.02);
      c.drawPath(ecg, trazo('#FFFFFF', k * 0.05));
      c.drawOval(Skia.XYWHRect(m - k * 0.3, n - k * 0.26, k * 0.14, k * 0.09), pincel('rgba(255,255,255,0.8)'));
      destello(c, m + k * 0.38, n - k * 0.36, k * 0.1, '#FFF3B0');
      destello(c, m - k * 0.4, n + k * 0.28, k * 0.07, '#FFF3B0');
      break;
    }
    default: { // La caja de cartón con su cinta
      c.drawRect(Skia.XYWHRect(m - k * 0.12, n - k * 0.5, k * 0.24, k), pincel('rgba(255,240,210,0.75)'));
      c.drawLine(m - k * 0.12, n - k * 0.5, m - k * 0.12, n + k * 0.5, trazo('rgba(120,70,30,0.3)', k * 0.02));
      c.drawLine(m + k * 0.12, n - k * 0.5, m + k * 0.12, n + k * 0.5, trazo('rgba(120,70,30,0.3)', k * 0.02));
      c.drawLine(m - k * 0.5, n - k * 0.18, m - k * 0.2, n - k * 0.18, trazo('rgba(120,70,30,0.25)', k * 0.025));
      c.drawLine(m + k * 0.2, n - k * 0.18, m + k * 0.5, n - k * 0.18, trazo('rgba(120,70,30,0.25)', k * 0.025));
    }
  }
}

// Una pieza (o la caja) como imagen de lado S, con su sombra suave horneada.
function hornear(S, tier) {
  const d = PixelRatio.get();
  const sup = Skia.Surface.Make(Math.ceil(S * d), Math.ceil(S * d));
  if (!sup) return null;
  const c = sup.getCanvas();
  c.scale(d, d);
  const m = S / 2; const T = S * 0.82; const x = m - T / 2; const y = m - T / 2 - S * 0.025; const r = T * 0.3;
  const sombra = pincel('rgba(10,0,35,0.4)');
  sombra.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, S * 0.035, true));
  c.drawRRect(rr(x + S * 0.01, y + S * 0.055, T, T, r), sombra);
  const [claro, fuerte] = tier === CAJA ? TONO_CAJA : COLORES[tier];
  c.drawRRect(rr(x, y, T, T, r), degradado(x, y, x + T * 0.6, y + T, [claro, fuerte]));
  c.save(); c.clipRRect(rr(x, y, T, T, r), ClipOp.Intersect, true);
  if (tier === CAJA) icono(c, CAJA, m, y + T / 2, T, fuerte);
  c.restore();
  // El brillo de arriba y un borde claro: el «vidrio» de la pieza.
  c.drawRRect(rr(x + T * 0.07, y + T * 0.05, T * 0.86, T * 0.42, r * 0.8), degradado(0, y, 0, y + T * 0.47, ['rgba(255,255,255,0.42)', 'rgba(255,255,255,0)']));
  c.drawRRect(rr(x + 0.7, y + 0.7, T - 1.4, T - 1.4, r), trazo(tier === MAX ? '#FFD86B' : 'rgba(255,255,255,0.55)', tier === MAX ? S * 0.03 : 1.2));
  if (tier !== CAJA) icono(c, tier, m, y + T / 2, T * 0.66, fuerte);
  sup.flush();
  return sup.makeImageSnapshot();
}
function hornearTodo(S) {
  const items = [null];
  for (let t = 1; t <= MAX; t++) items.push(hornear(S, t));
  const caja = hornear(S, CAJA);
  if (items.some((x, i) => i > 0 && !x) || !caja) return null;
  return { items, caja, S, src: Skia.XYWHRect(0, 0, items[1].width(), items[1].height()) };
}
// El tablero de fondo: un panel de vidrio con sus casillas.
function hornearFondo(g) {
  const d = PixelRatio.get();
  const sup = Skia.Surface.Make(Math.ceil(g.lado * d), Math.ceil(g.lado * d));
  if (!sup) return null;
  const c = sup.getCanvas();
  c.scale(d, d);
  c.drawRRect(rr(0, 0, g.lado, g.lado, 26), degradado(0, 0, g.lado, g.lado, ['rgba(255,255,255,0.13)', 'rgba(255,255,255,0.06)']));
  c.drawRRect(rr(0.5, 0.5, g.lado - 1, g.lado - 1, 26), trazo('rgba(255,255,255,0.2)', 1));
  const p = g.pad; const e = g.celda;
  for (let i = 0; i < g.C * g.C; i++) {
    const x = p + (i % g.C) * e; const y = p + Math.floor(i / g.C) * e;
    c.drawRRect(rr(x + e * 0.06, y + e * 0.06, e * 0.88, e * 0.88, e * 0.24), pincel('rgba(10,0,40,0.16)'));
    c.drawRRect(rr(x + e * 0.06, y + e * 0.06, e * 0.88, e * 0.88, e * 0.24), trazo('rgba(255,255,255,0.08)', 1));
  }
  sup.flush();
  return sup.makeImageSnapshot();
}

function medida(caja, C) {
  if (!caja) return null;
  const lado = Math.floor(Math.min(caja.w, caja.h));
  const pad = Math.max(6, lado * 0.025);
  const celda = (lado - pad * 2) / C;
  const ox = (caja.w - lado) / 2; const oy = (caja.h - lado) / 2;
  return { w: caja.w, h: caja.h, C, lado, pad, celda, ox, oy, x0: ox + pad, y0: oy + pad };
}

// ── La cadena de abajo: las nueve piezas, las ya vistas encendidas ─────────────
function Cadena({ sprites, max, meta }) {
  const [w, setW] = useState(0);
  const gap = 5;
  const s = w ? Math.min(46, (w - gap * 8) / 9) : 0;
  const pic = useMemo(() => {
    if (!w || !sprites) return null;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, w, s + 8));
    const x0 = (w - (s * 9 + gap * 8)) / 2;
    const p = Skia.Paint();
    for (let i = 1; i <= MAX; i++) {
      const x = x0 + (i - 1) * (s + gap);
      p.setAlphaf(i <= max ? 1 : 0.32);
      c.drawImageRectOptions(sprites.items[i], sprites.src, Skia.XYWHRect(x, 4, s, s), FilterMode.Linear, MipmapMode.Linear, p);
      if (i === meta) c.drawRRect(rr(x - 1, 3, s + 2, s + 2, s * 0.32), trazo('#FFFFFF', 2));
    }
    return rec.finishRecordingAsPicture();
  }, [w, s, sprites, max, meta]);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: (s || 40) + 8 }} accessible
      accessibilityLabel={`La cadena: ${NOMBRES.slice(1).join(', ')}. Llevas hasta ${NOMBRES[max] ?? 'la gota'}.`}>
      {pic ? <Canvas style={{ flex: 1 }}><Picture picture={pic} /></Canvas> : null}
    </View>
  );
}

function Pieza({ sprites, tier, tam = 56 }) {
  if (!sprites) return <View style={{ width: tam, height: tam }} />;
  return (
    <Canvas style={{ width: tam, height: tam }}>
      <ImagenSkia image={tier === CAJA ? sprites.caja : sprites.items[tier]} x={0} y={0} width={tam} height={tam} fit="contain" />
    </Canvas>
  );
}

function Estrellas({ n, tam = 30 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={`${n} de 3 estrellas`}>
      {[1, 2, 3].map((k) => <Icono key={k} sf="star.fill" respaldo="★" tam={tam} color={k <= n ? '#FFD86B' : 'rgba(255,255,255,0.25)'} />)}
    </View>
  );
}

function BotonChico({ sf, etiqueta, alTocar }) {
  return (
    <Tocable etiqueta={etiqueta} alTocar={() => { tacto.roce(); alTocar(); }}>
      <View style={estilos.redondo}><Icono sf={sf} respaldo="" tam={18} color={BLANCO} /></View>
    </Tocable>
  );
}

export default function Botiquin() {
  const quieta = useSinMovimiento();
  const [fase, setFase] = useState('portada'); // portada · jugando
  const [modo, setModo] = useState('niveles');
  const [nivel, setNivel] = useState(1);
  const [abierto, setAbierto] = useState(1);
  const [estrellas, setEstrellas] = useState({});
  const [record, setRecord] = useState(0);
  const [conf, setConf] = useState(NIVELES[0]);
  const [vista, setVista] = useState({ movs: 0, creados: 0, rotas: 0, puntos: 0, max: 1, combo: 0 });
  const [fin, setFin] = useState(null); // { tipo: 'gano' | 'movs' | 'lleno' | 'relax', estrellas, nuevoRecord }
  const [pausa, setPausa] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [novedad, setNovedad] = useState(null); // { k, tier }
  const [festejo, setFestejo] = useState(0);
  const [caja, setCaja] = useState(null);
  const juego = useRef({ movs: 0, creados: 0, rotas: 0, puntos: 0, max: 1, combo: 0, vistos: 1 });
  const confRef = useRef(NIVELES[0]);
  const modoRef = useRef('niveles');
  const nivelRef = useRef(1);
  const recordRef = useRef(0);
  const relojes = useRef([]);
  const luego = (fn, ms) => { relojes.current.push(setTimeout(fn, ms)); };

  // El tablero vive en el hilo de la interfaz.
  const tablero = useSharedValue([]);
  const nacio = useSharedValue([]);
  const fusion = useSharedValue([]);
  const roto = useSharedValue([]);
  const arr = useSharedValue({ i: -1, tier: 0, dx: 0, dy: 0, t: 0 });
  const dedo = useSharedValue({ x: 0, y: 0 });
  const vuelta = useSharedValue(null);
  const golpe = useSharedValue(null);
  const chispas = useSharedValue([]);
  const guia = useSharedValue(null); // la mano del primer nivel: { o, d }
  const p2 = useSharedValue(0.25);
  const bloqueada = useSharedValue(true);
  const geoV = useSharedValue(null);
  const imgs = useSharedValue(null);
  const tiempo = useSharedValue(0);
  const ahora = useSharedValue(0);
  const hasta = useSharedValue(0);
  const acum = useSharedValue(0);
  const respira = useSharedValue(!quieta);
  useEffect(() => { respira.value = !quieta; }, [quieta, respira]);

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE_NIVEL).then((v) => { const n = Math.max(1, Number(v) || 1); setAbierto(n); setNivel(n); nivelRef.current = n; }).catch(() => {});
    SecureStore.getItemAsync(CLAVE_RECORD).then((v) => { const n = Number(v) || 0; recordRef.current = n; setRecord(n); }).catch(() => {});
    SecureStore.getItemAsync(CLAVE_ESTRELLAS).then((v) => { try { const e = JSON.parse(v || '{}'); if (e && typeof e === 'object') setEstrellas(e); } catch { /* vacío */ } }).catch(() => {});
    return () => { relojes.current.forEach(clearTimeout); callar(SONIDOS); };
  }, []);

  // Las piezas de la portada y de la cadena: una vez.
  const chicas = useMemo(() => hornearTodo(56), []);

  const geo = useMemo(() => medida(caja, conf.C), [caja, conf.C]);
  useEffect(() => { geoV.value = geo; }, [geo, geoV]);
  useEffect(() => {
    if (!geo) return;
    const s = hornearTodo(geo.celda);
    const fondo = hornearFondo(geo);
    if (!s || !fondo) return;
    const tonos = CHISPA_COLOR.map((c2) => (c2 ? col(c2) : null));
    imgs.value = { ...s, fondo, srcFondo: Skia.XYWHRect(0, 0, fondo.width(), fondo.height()), tonos };
  }, [geo, imgs]);

  // El reloj: `ahora` corre cada cuadro mientras algo se anima; quieto, el
  // «respirar» de las piezas se pinta a 30 cuadros (y nada con reducir movimiento).
  useFrameCallback((f) => {
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    tiempo.value += dt;
    if (tiempo.value < hasta.value || arr.value.i >= 0) { ahora.value = tiempo.value; acum.value = 0; return; }
    if (!respira.value) { if (ahora.value < hasta.value) ahora.value = hasta.value; return; }
    acum.value += dt;
    if (acum.value >= 0.033) { ahora.value = tiempo.value; acum.value = 0; }
  });

  const cuadro = useDerivedValue(() => {
    const rec = Skia.PictureRecorder();
    const g = geoV.value;
    const im = imgs.value;
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.w : 1, g ? g.h : 1));
    const b = tablero.value;
    if (!g || !im || b.length !== g.C * g.C) return rec.finishRecordingAsPicture();
    const t = ahora.value;
    const na = nacio.value; const fu = fusion.value; const ro = roto.value;
    const a = arr.value; const v = vuelta.value; const gp = golpe.value;
    const p = Skia.Paint();
    const S = im.S;
    const estampa = (img, x, y, sx, sy, alfa) => {
      p.setAlphaf(alfa);
      const w = S * sx; const h = S * sy;
      c.drawImageRect(img, im.src, Skia.XYWHRect(x - w / 2, y - h / 2, w, h), p);
    };
    c.drawImageRect(im.fondo, im.srcFondo, Skia.XYWHRect(g.ox, g.oy, g.lado, g.lado), p);

    // Mientras se arrastra: las iguales de al lado brillan y la casilla de destino se marca.
    let ix = 0; let iy = 0; let kl = 0;
    if (a.i >= 0) {
      kl = Math.min(1, (t - a.t) / LEVANTA);
      ix = dedo.value.x + a.dx;
      iy = dedo.value.y + a.dy - g.celda * 0.16 * kl;
      const d = celdaDe(g, ix, iy);
      const marco = Skia.Paint(); marco.setAntiAlias(true); marco.setStyle(PaintStyle.Stroke); marco.setStrokeWidth(2.5);
      const relleno = Skia.Paint(); relleno.setAntiAlias(true);
      const latido = 0.55 + 0.25 * Math.sin(t * 7);
      for (let j = 0; j < b.length; j++) {
        if (b[j] !== a.tier || !vecinas(a.i, j, g.C)) continue;
        const x = centroX(g, j); const y = centroY(g, j); const e = g.celda * 0.9;
        const ok = j === d;
        relleno.setColor(Skia.Color(ok ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)'));
        c.drawRRect(rrw(x - e / 2, y - e / 2, e, e, e * 0.26), relleno);
        marco.setColor(Skia.Color('#FFFFFF')); marco.setAlphaf(ok ? 1 : latido);
        c.drawRRect(rrw(x - e / 2, y - e / 2, e, e, e * 0.26), marco);
      }
      if (d >= 0 && d !== a.i && b[d] === 0) {
        const x = centroX(g, d); const y = centroY(g, d); const e = g.celda * 0.84;
        relleno.setColor(Skia.Color('rgba(255,255,255,0.16)'));
        c.drawRRect(rrw(x - e / 2, y - e / 2, e, e, e * 0.26), relleno);
      }
    }

    for (let i = 0; i < b.length; i++) {
      const x = centroX(g, i); const y = centroY(g, i);
      // Una caja que se rompe: crece y se apaga.
      if (ro[i] > 0 && t < ro[i] + ROMPE) {
        const q = Math.max(0, (t - ro[i]) / ROMPE);
        estampa(im.caja, x, y, 1 + 0.4 * q, 1 + 0.4 * q, 1 - q);
      }
      const tier = b[i];
      if (tier === 0) continue;
      if (tier === CAJA) { estampa(im.caja, x, y, 1, 1, 1); continue; }
      if (a.i === i) { estampa(im.items[tier], x, y, 0.92, 0.92, 0.25); continue; }
      if (v && v.i === i && t < v.t + VUELTA) continue;
      if (gp && gp.i === i && t < gp.t + JUNTA) continue;
      if (t < na[i]) continue;
      let sx = 1; let sy = 1;
      const kn = (t - na[i]) / NACE;
      if (na[i] >= 0 && kn < 1) { const s = saltito(kn); sx = s; sy = s; }
      const kf = (t - fu[i]) / POP;
      if (kf >= 0 && kf < 1) {
        // Estira y encoge: ancha primero, alta después, y se asienta.
        const amort = 1 - kf;
        sx *= 1 + 0.34 * Math.sin(kf * Math.PI * 2.2) * amort;
        sy *= 1 - 0.24 * Math.sin(kf * Math.PI * 2.2) * amort + 0.1 * Math.sin(kf * Math.PI) * amort;
      } else if (respira.value) {
        // Respirar: muy poquito, cada una a su ritmo.
        const r = 1 + 0.022 * Math.sin(t * 2.1 + i * 1.3);
        sx *= r; sy *= 2 - r;
      }
      estampa(im.items[tier], x, y, sx, sy, 1);
    }

    // Las dos piezas que se acercan antes de unirse.
    if (gp && t < gp.t + JUNTA) {
      const q = Math.max(0, (t - gp.t) / JUNTA); const e = q * q;
      const gx = centroX(g, gp.i); const gy = centroY(g, gp.i);
      estampa(im.items[gp.tier], gx, gy, 1 + 0.06 * q, 1 + 0.06 * q, 1);
      estampa(im.items[gp.tier], gp.x + (gx - gp.x) * e, gp.y + (gy - gp.y) * e, 1.14 - 0.1 * e, 1.14 - 0.1 * e, 1);
    }
    // La que vuelve a su casilla, con un resorte.
    if (v && t < v.t + VUELTA) {
      const q = Math.max(0, (t - v.t) / VUELTA); const e = saltito(q);
      const vx = centroX(g, v.i); const vy = centroY(g, v.i);
      const s = 1.14 - 0.14 * Math.min(1, q * 1.4);
      estampa(im.items[v.tier], v.x + (vx - v.x) * e, v.y + (vy - v.y) * e, s, s, 1);
    }

    // Chispas, destellos y un anillo que se abre.
    const chispa = Skia.Paint(); chispa.setAntiAlias(true);
    const anillo = Skia.Paint(); anillo.setAntiAlias(true); anillo.setStyle(PaintStyle.Stroke);
    anillo.setColor(Skia.Color('white'));
    for (const s of chispas.value) {
      const q = (t - s.t) / (s.grande ? CHISPA * 1.5 : CHISPA);
      if (q < 0 || q > 1) continue;
      const cuantas = s.grande ? 18 : 11;
      const R = g.celda * (s.grande ? 0.5 : 0.36);
      for (let j = 0; j < cuantas; j++) {
        const ang = (j / cuantas) * Math.PI * 2 + s.giro;
        const dd = R * (0.6 + q * (1.5 + (j % 3) * 0.35) * (s.grande ? 1.6 : 1));
        chispa.setColor(j % 3 === 0 ? Skia.Color('#FFFFFF') : im.tonos[s.c]);
        chispa.setAlphaf(1 - q * q);
        c.drawCircle(s.x + Math.cos(ang) * dd, s.y + Math.sin(ang) * dd + q * q * R * 0.7, Math.max(0.1, (2 + (j % 2) * 1.8) * (1 - q) * (s.grande ? 1.4 : 1)), chispa);
      }
      const qa = Math.min(1, q / 0.6);
      anillo.setStrokeWidth(3 * (1 - qa) + 0.5);
      anillo.setAlphaf((1 - qa) * 0.7);
      c.drawCircle(s.x, s.y, R * (0.9 + qa * (s.grande ? 2.2 : 1.1)), anillo);
    }

    // La mano del primer nivel: muestra el gesto sobre una pareja.
    const gu = guia.value;
    if (gu && a.i < 0 && b[gu.o] > 0 && b[gu.o] === b[gu.d]) {
      const ciclo = (t % 2.2) / 2.2;
      const mov = Math.max(0, Math.min(1, (ciclo - 0.2) / 0.5));
      const e = mov * mov * (3 - 2 * mov);
      const ox = centroX(g, gu.o); const oy = centroY(g, gu.o);
      const hx = ox + (centroX(g, gu.d) - ox) * e; const hy = oy + (centroY(g, gu.d) - oy) * e;
      const alfa = ciclo < 0.1 ? ciclo / 0.1 : ciclo > 0.85 ? (1 - ciclo) / 0.15 : 1;
      estampa(im.items[b[gu.o]], hx, hy - g.celda * 0.12, 1.08, 1.08, 0.55 * alfa);
      chispa.setColor(Skia.Color('#FFFFFF')); chispa.setAlphaf(0.85 * alfa);
      c.drawCircle(hx + g.celda * 0.18, hy + g.celda * 0.22, g.celda * 0.15, chispa);
      anillo.setStrokeWidth(2); anillo.setAlphaf(0.6 * alfa * (1 - e * 0.5));
      c.drawCircle(hx + g.celda * 0.18, hy + g.celda * 0.22, g.celda * (0.2 + 0.08 * Math.sin(t * 6)), anillo);
    }

    // La que va en el dedo, encima de todo: levantada y un poco más grande.
    if (a.i >= 0) {
      const s = 1 + 0.16 * kl;
      estampa(im.items[a.tier], ix, iy, s, s, 1);
    }
    return rec.finishRecordingAsPicture();
  });

  // ── JavaScript: sonido, vibración, metas ─────────────────────────────────────
  const terminar = useCallback((tipo) => {
    const j = juego.current;
    const cf = confRef.current;
    bloqueada.value = true;
    guia.value = null;
    if (tipo === 'gano') {
      const n = nivelRef.current;
      const est = estrellasDe(cf.movs - j.movs, cf.movs);
      sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1);
      setEstrellas((e) => {
        if ((e[n] ?? 0) >= est) return e;
        const nuevo = { ...e, [n]: est };
        SecureStore.setItemAsync(CLAVE_ESTRELLAS, JSON.stringify(nuevo)).catch(() => {});
        return nuevo;
      });
      setAbierto((ab) => {
        if (n + 1 <= ab) return ab;
        SecureStore.setItemAsync(CLAVE_NIVEL, String(n + 1)).catch(() => {});
        return n + 1;
      });
      luego(() => setFin({ tipo, estrellas: est }), 700);
    } else if (tipo === 'relax') {
      const nuevoRecord = j.puntos > 0 && j.puntos >= recordRef.current;
      sonar('par'); tacto.aviso();
      luego(() => setFin({ tipo, nuevoRecord }), 500);
    } else {
      sonar('fallo', { volumen: 0.6 }); tacto.aviso();
      luego(() => setFin({ tipo }), 500);
    }
  }, [bloqueada, guia]);

  const manejar = useRef(null);
  manejar.current = (tipo, tier, cajas, atascado) => {
    const j = juego.current;
    const cf = confRef.current;
    const relax = modoRef.current === 'relax';
    j.movs += 1;
    if (guia.value) guia.value = null;
    if (tipo === 1) {
      j.combo = 0;
      sonar('gota', { volumen: 0.45 }); tacto.toque();
    } else if (tipo === 2) {
      j.combo += 1;
      const nota = Math.max(1, Math.min(6, tier - 1));
      sonar(`toque-${nota}`, { volumen: 0.8, tono: tier >= 8 ? 1.12 : 1 });
      sonar(j.combo >= 3 ? 'pop-5' : 'pop-3', { volumen: 0.55 });
      tacto.golpe();
      const extra = j.combo >= 2 ? j.combo : 1;
      j.puntos += PUNTOS[tier] * extra;
      if (cf.meta === tier) j.creados += 1;
      if (tier > j.vistos) {
        j.vistos = tier;
        luego(() => { sonar('par', { volumen: 0.7 }); tacto.exito(); }, 120);
        setNovedad({ k: Date.now(), tier });
        luego(() => setNovedad((nv) => (nv && nv.tier === tier ? null : nv)), 1700);
      } else if (j.combo >= 2) setAviso({ k: Date.now(), texto: `¡Combo ×${j.combo}! ${NOMBRES[tier]}` });
      else setAviso({ k: Date.now(), texto: `¡${NOMBRES[tier]}!` });
      j.max = Math.max(j.max, tier);
    } else if (tipo === 3) {
      j.combo += 1;
      j.puntos += 1000;
      sonar('ganar', { volumen: 0.8 }); tacto.exito(); setFestejo((k) => k + 1);
      setAviso({ k: Date.now(), texto: '¡Dos corazones sanos! +1000' });
    }
    if (cajas) { j.rotas += cajas; sonar('bloque', { volumen: 0.7 }); luego(() => tacto.toque(), 60); }
    setVista({ ...j });
    if (relax) {
      if (j.puntos > recordRef.current) {
        recordRef.current = j.puntos; setRecord(j.puntos);
        SecureStore.setItemAsync(CLAVE_RECORD, String(j.puntos)).catch(() => {});
      }
      if (atascado) terminar('relax');
      return;
    }
    if (j.creados >= cf.cuantas && j.rotas >= cf.cajas) terminar('gano');
    else if (j.movs >= cf.movs) terminar('movs');
    else if (atascado) terminar('lleno');
  };
  const alJugar = useCallback((...x) => manejar.current?.(...x), []);
  const alTomar = useCallback((tier) => { tacto.roce(); sonar('pop-2', { volumen: 0.25, tono: 0.9 + tier * 0.03 }); }, []);
  const alRebotar = useCallback((motivo, tier) => {
    tacto.roce();
    if (motivo === 'lejos') setAviso({ k: Date.now(), texto: 'Tienen que estar una al lado de la otra' });
    else if (motivo === 'distinta') setAviso({ k: Date.now(), texto: 'Sólo se unen dos iguales' });
    else if (motivo === 'toque' && tier > 0) setAviso({ k: Date.now(), texto: tier < MAX ? `${NOMBRES[tier]} + ${NOMBRES[tier]} = ${NOMBRES[tier + 1]}` : 'Junta dos corazones sanos: +1000' });
  }, []);

  // Una jugada, decidida en el hilo de la interfaz. Devuelve 0 si no se podía.
  const actuar = useMemo(() => (o, d, x, y) => {
    'worklet';
    const g = geoV.value;
    if (!g) return 0;
    const C = g.C;
    const b = tablero.value.slice();
    const tier = b[o];
    const t = tiempo.value;
    let tipo = 0;
    if (tier <= 0) return 0;
    if (b[d] === 0) { b[d] = tier; b[o] = 0; tipo = 1; } else if (b[d] === tier && vecinas(o, d, C)) {
      tipo = tier === MAX ? 3 : 2; b[o] = 0; b[d] = tipo === 3 ? 0 : tier + 1;
    } else return 0;
    const na = nacio.value.slice(); const fu = fusion.value.slice(); const ro = roto.value.slice();
    const cx = centroX(g, d); const cy = centroY(g, d);
    let cajas = 0;
    const viejas = chispas.value.filter((s) => t - s.t < CHISPA * 1.6);
    if (tipo === 1) {
      na[d] = t - NACE * 0.55; fu[d] = -10; // se asienta con un rebote corto
    } else {
      golpe.value = { tier, x, y, i: d, t };
      fu[d] = t + JUNTA; na[d] = -1;
      viejas.push({ x: cx, y: cy, t: t + JUNTA, c: tipo === 3 ? MAX : tier + 1, grande: tipo === 3 || tier + 1 >= 7, giro: (d * 1.7) % 6.28 });
      for (let k = 0; k < b.length; k++) {
        if (b[k] === CAJA && vecinas(d, k, C)) {
          b[k] = 0; ro[k] = t + JUNTA; cajas++;
          viejas.push({ x: centroX(g, k), y: centroY(g, k), t: t + JUNTA, c: 10, grande: false, giro: k });
        }
      }
    }
    chispas.value = viejas;
    // La pieza nueva, en un hueco al azar (no justo donde se jugó, si hay otro).
    const libres = [];
    for (let k = 0; k < b.length; k++) if (b[k] === 0 && k !== o && k !== d) libres.push(k);
    if (!libres.length) for (let k = 0; k < b.length; k++) if (b[k] === 0) libres.push(k);
    if (libres.length) {
      const k = libres[Math.floor(Math.random() * libres.length)];
      b[k] = Math.random() < p2.value ? 2 : 1;
      na[k] = t + (tipo === 1 ? 0.1 : 0.3); fu[k] = -10;
    }
    let lleno = true;
    for (let k = 0; k < b.length; k++) if (b[k] === 0) { lleno = false; break; }
    const atascado = lleno && !hayPareja(b, C);
    tablero.value = b; nacio.value = na; fusion.value = fu; roto.value = ro;
    hasta.value = Math.max(hasta.value, t + (tipo === 3 ? CHISPA * 1.6 : 0.9));
    if (atascado) bloqueada.value = true;
    runOnJS(alJugar)(tipo, tipo === 2 ? tier + 1 : tier, cajas, atascado);
    return tipo;
  }, [alJugar, bloqueada, chispas, fusion, geoV, golpe, hasta, nacio, p2, roto, tablero, tiempo]);

  const gesto = useMemo(() => Gesture.Pan().minDistance(0).maxPointers(1)
    .onBegin((e) => {
      const g = geoV.value;
      if (!g || bloqueada.value) return;
      const i = celdaDe(g, e.x, e.y);
      if (i < 0) return;
      const tier = tablero.value[i];
      if (tier <= 0 || tiempo.value < nacio.value[i]) return;
      if (vuelta.value && vuelta.value.i === i && tiempo.value < vuelta.value.t + VUELTA) return;
      arr.value = { i, tier, dx: centroX(g, i) - e.x, dy: centroY(g, i) - e.y, t: tiempo.value };
      dedo.value = { x: e.x, y: e.y };
      runOnJS(alTomar)(tier);
    })
    .onUpdate((e) => {
      if (arr.value.i < 0) return;
      dedo.value = { x: e.x, y: e.y };
    })
    .onFinalize(() => {
      const a = arr.value;
      const g = geoV.value;
      if (a.i < 0 || !g) return;
      const t = tiempo.value;
      const kl = Math.min(1, (t - a.t) / LEVANTA);
      const x = dedo.value.x + a.dx;
      const y = dedo.value.y + a.dy - g.celda * 0.16 * kl;
      arr.value = { i: -1, tier: 0, dx: 0, dy: 0, t: 0 };
      const d = celdaDe(g, x, y);
      if (d >= 0 && d !== a.i && actuar(a.i, d, x, y) > 0) return;
      vuelta.value = { tier: a.tier, x, y, i: a.i, t };
      hasta.value = Math.max(hasta.value, t + VUELTA + 0.05);
      if (d === a.i || d < 0) {
        if (d === a.i && Math.hypot(dedo.value.x + a.dx - centroX(g, a.i), dedo.value.y + a.dy - centroY(g, a.i)) < g.celda * 0.3) runOnJS(alRebotar)('toque', a.tier);
        return;
      }
      const otra = tablero.value[d];
      runOnJS(alRebotar)(otra === a.tier ? 'lejos' : 'distinta', a.tier);
    }), [actuar, alRebotar, alTomar, arr, bloqueada, dedo, geoV, hasta, nacio, tablero, tiempo, vuelta]);

  const empezar = useCallback((m, n) => {
    const cf = m === 'relax' ? RELAX : nivelDe(n);
    relojes.current.forEach(clearTimeout); relojes.current = [];
    confRef.current = cf; setConf(cf);
    modoRef.current = m; nivelRef.current = n;
    const b = tableroInicial(cf);
    const N = b.length;
    const t = tiempo.value;
    const na = new Array(N).fill(-1);
    let k = 0;
    for (let i = 0; i < N; i++) if (b[i] !== 0) { na[i] = t + 0.25 + k * 0.035; k++; }
    // El tamaño del tablero cambia antes que las piezas: así el dibujo nunca mezcla los dos.
    geoV.value = medida(caja, cf.C);
    tablero.value = b; nacio.value = na;
    fusion.value = new Array(N).fill(-10); roto.value = new Array(N).fill(-1);
    chispas.value = []; golpe.value = null; vuelta.value = null;
    arr.value = { i: -1, tier: 0, dx: 0, dy: 0, t: 0 };
    p2.value = cf.p2;
    hasta.value = t + 0.25 + k * 0.035 + NACE + 0.1;
    bloqueada.value = false;
    let max = 1; for (const v of b) max = Math.max(max, v);
    juego.current = { movs: 0, creados: 0, rotas: 0, puntos: 0, max, combo: 0, vistos: max };
    setVista({ ...juego.current });
    // En el primer nivel, una mano muestra el gesto hasta la primera jugada.
    guia.value = m === 'niveles' && n === 1 ? (() => { const par = buscarPareja(b, cf.C); return par ? { o: par[0], d: par[1] } : null; })() : null;
    setFin(null); setPausa(false); setNovedad(null);
    setAviso({ k: Date.now(), texto: m === 'relax' ? 'Relax: sin límite de movimientos' : `Nivel ${n} · ${textoMeta(cf)}` });
    setFase('jugando');
    sonar('pop-5', { volumen: 0.3 });
  }, [arr, bloqueada, caja, chispas, fusion, geoV, golpe, guia, hasta, nacio, p2, roto, tablero, tiempo, vuelta]);

  const cambiarModo = (m) => { setModo(m); };
  const relax = conf === RELAX;
  const sobran = relax ? 0 : conf.movs - vista.movs;
  const siguiente = Math.min(MAX, vista.max + 1);
  const escalaLetra = PixelRatio.getFontScale();
  const altoAviso = Math.ceil(15 * escalaLetra * 1.3) * (escalaLetra > 1.25 ? 2 : 1) + 12;

  if (fase === 'portada') {
    const cf = nivelDe(nivel);
    return (
      <Escena colores={ESCENAS.botiquin}>
        <ControlesSensaciones izquierda={modo === 'relax'
          ? <Marcador sf="trophy.fill" texto={`Récord ${entero(record)}`} />
          : <Marcador sf="star.fill" texto={`Nivel ${abierto}`} etiqueta={`Llegaste al nivel ${abierto}`} />} />
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Pieza sprites={chicas} tier={8} tam={84} />
          <Text style={{ fontSize: 30, fontWeight: '900', color: BLANCO, textAlign: 'center' }}>Botiquín</Text>
          <Text style={[textoAyuda, { textAlign: 'center' }]}>
            Arrastra una pieza sobre otra igual que esté a su lado: se unen y se convierten en la siguiente. ¿Llegarás al corazón sano?
          </Text>
        </View>

        <PanelVidrio estilo={{ gap: 12 }}>
          <Text style={estilos.titulo}>La cadena</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: 12, columnGap: 6 }}>
            {NOMBRES.slice(1).map((nombre, i) => (
              <View key={nombre} style={{ flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 4 }}>
                <Pieza sprites={chicas} tier={i + 1} tam={52} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: BLANCO, textAlign: 'center' }}>{nombre}</Text>
              </View>
            ))}
          </View>
          <Text style={[textoAyuda, { fontSize: 13, textAlign: 'center' }]}>Dos iguales hacen la siguiente. Dos corazones sanos juntos valen 1.000 puntos.</Text>
        </PanelVidrio>

        <OpcionesJuego opciones={MODOS} valor={modo} alCambiar={cambiarModo} />

        {modo === 'niveles' ? (
          <PanelVidrio estilo={{ gap: 12 }}>
            <Text style={estilos.titulo}>Elige un nivel</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
              {Array.from({ length: abierto }, (_, i) => i + 1).map((n) => {
                const activo = n === nivel;
                const e = estrellas[n] ?? 0;
                return (
                  <Tocable key={n} etiqueta={`Nivel ${n}${e ? `, ${e} estrellas` : ''}`} alTocar={() => { tacto.roce(); setNivel(n); }}>
                    <View accessibilityRole="radio" accessibilityState={{ selected: activo }}
                      style={[estilos.nivel, activo && { backgroundColor: BLANCO, borderColor: BLANCO }]}>
                      <Text style={{ fontSize: 17, fontWeight: '900', color: activo ? '#1B1B2F' : BLANCO }}>{n}</Text>
                      <Text style={{ fontSize: 10, letterSpacing: 1, color: activo ? '#C98A00' : '#FFD86B' }}>{'★'.repeat(e)}{'☆'.repeat(3 - e)}</Text>
                    </View>
                  </Tocable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pieza sprites={chicas} tier={cf.meta} tam={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: BLANCO }}>Nivel {nivel}: {textoMeta(cf)}</Text>
                <Text style={{ fontSize: 13, color: BLANCO_2 }}>
                  Tablero de {cf.C}×{cf.C} · {cf.movs} movimientos{cf.cajas ? ' · las cajas se rompen al unir una pareja a su lado' : ''}
                </Text>
              </View>
            </View>
          </PanelVidrio>
        ) : (
          <PanelVidrio estilo={{ gap: 6 }}>
            <Text style={estilos.titulo}>Relax</Text>
            <Text style={textoAyuda}>Sin límite de movimientos: junta piezas a tu ritmo hasta que el tablero se llene. Los combos (uniones seguidas) valen el doble y el triple.</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: BLANCO }}>Tu récord: {entero(record)} puntos</Text>
          </PanelVidrio>
        )}

        <BotonJuego sf="play.fill" alTocar={() => empezar(modo, modo === 'relax' ? 1 : nivel)}>
          {modo === 'relax' ? 'Jugar en Relax' : `Jugar el nivel ${nivel}`}
        </BotonJuego>
      </Escena>
    );
  }

  const estado = relax
    ? `Relax. ${entero(vista.puntos)} puntos.`
    : `Nivel ${nivel}. ${textoMeta(conf)}. Llevas ${vista.creados} de ${conf.cuantas}${conf.cajas ? ` y ${vista.rotas} de ${conf.cajas} cajas` : ''}. Quedan ${sobran} movimientos.`;

  return (
    <Escena colores={ESCENAS.botiquin} fijo estilo={{ gap: 12 }}>
      <ControlesSensaciones izquierda={<>
        <BotonChico sf="pause.fill" etiqueta="Pausa" alTocar={() => setPausa(true)} />
        {relax ? <>
          <Marcador sf="sparkles" texto={entero(vista.puntos)} etiqueta={`${entero(vista.puntos)} puntos`} />
          <Marcador sf="trophy.fill" texto={entero(record)} etiqueta={`Récord: ${entero(record)} puntos`} />
        </> : <>
          <Marcador sf="hand.draw.fill" texto={`${sobran}`} etiqueta={`Quedan ${sobran} movimientos`} />
        </>}
      </>} />

      {!relax ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} accessible accessibilityLabel={estado}>
          <View style={[estilos.meta, vista.creados >= conf.cuantas && estilos.metaLista]}>
            <Pieza sprites={chicas} tier={conf.meta} tam={30} />
            <Text style={estilos.metaTexto}>{Math.min(vista.creados, conf.cuantas)}/{conf.cuantas}</Text>
            {vista.creados >= conf.cuantas ? <Icono sf="checkmark" respaldo="✓" tam={14} color={BLANCO} /> : null}
          </View>
          {conf.cajas ? (
            <View style={[estilos.meta, vista.rotas >= conf.cajas && estilos.metaLista]}>
              <Pieza sprites={chicas} tier={CAJA} tam={30} />
              <Text style={estilos.metaTexto}>{Math.min(vista.rotas, conf.cajas)}/{conf.cajas}</Text>
              {vista.rotas >= conf.cajas ? <Icono sf="checkmark" respaldo="✓" tam={14} color={BLANCO} /> : null}
            </View>
          ) : null}
          <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: '700', color: BLANCO_2 }}>Nivel {nivel}</Text>
        </View>
      ) : null}

      {/* El aviso tiene su lugar fijo encima del tablero (alto según el tamaño de
          letra, para no tapar la primera fila ni cambiar la medida del tablero
          cada vez que cambia el texto). */}
      <View pointerEvents="none" style={{ height: altoAviso, justifyContent: 'flex-end', alignItems: 'center' }}>
        {aviso && !fin && !novedad ? <AvisoJuego clave={aviso.k} texto={aviso.texto} /> : null}
      </View>

      <View style={{ flex: 1 }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (!caja || caja.w !== w || caja.h !== h) setCaja({ w, h }); }}
        accessible accessibilityLabel={`Tablero de ${conf.C} por ${conf.C}. ${estado} Arrastra una pieza sobre otra igual que esté a su lado.`}
        accessibilityActions={[{ name: 'activate', label: 'Unir una pareja' }]}
        onAccessibilityAction={() => {
          runOnUI(() => {
            'worklet';
            const g = geoV.value;
            if (!g || bloqueada.value) return;
            const par = buscarPareja(tablero.value, g.C);
            if (par) actuar(par[0], par[1], centroX(g, par[0]), centroY(g, par[0]));
          })();
        }}>
        {geo ? (
          <GestureDetector gesture={gesto}>
            <Canvas style={{ flex: 1 }}>
              <Picture picture={cuadro} />
            </Canvas>
          </GestureDetector>
        ) : null}
        {novedad && !fin ? (
          <Animated.View key={novedad.k} pointerEvents="none" entering={ZoomIn.springify().damping(14)} exiting={FadeOut.duration(200)}
            style={{ position: 'absolute', left: 0, right: 0, top: '30%', alignItems: 'center' }}>
            <View style={estilos.novedad}>
              <Pieza sprites={chicas} tier={novedad.tier} tam={64} />
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFD86B' }}>¡NUEVO!</Text>
                <Text style={{ fontSize: 20, fontWeight: '900', color: BLANCO }}>{NOMBRES[novedad.tier]}</Text>
              </View>
            </View>
          </Animated.View>
        ) : null}
        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', '#FFD86B', '#FF9DE6', '#8BE9FF']} alTerminar={() => {}} /> : null}
      </View>

      <Cadena sprites={chicas} max={vista.max} meta={relax ? 0 : conf.meta} />
      <Text style={[textoAyuda, { textAlign: 'center', fontSize: 13, lineHeight: 18 }]}>
        {vista.max < MAX ? `Lo más alto: ${NOMBRES[vista.max]} · Sigue: ${NOMBRES[siguiente]}` : '¡Llegaste al corazón sano! Junta dos para +1.000'}
      </Text>

      {pausa || fin ? (
        <Animated.View entering={FadeIn.duration(220)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,8,30,0.5)' }]}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }}>
            <PanelVidrio estilo={{ gap: 12, alignItems: 'center', backgroundColor: 'rgba(24,10,48,0.88)' }}>
              {pausa && !fin ? <>
                <Text style={estilos.panelTitulo}>Pausa</Text>
                <Text style={[textoAyuda, { textAlign: 'center' }]}>{relax ? 'Tu tablero te espera.' : `Nivel ${nivel}: ${textoMeta(conf)}.`}</Text>
                <View style={{ alignSelf: 'stretch', gap: 10 }}>
                  <BotonJuego sf="play.fill" alTocar={() => setPausa(false)}>Seguir</BotonJuego>
                  <BotonJuego secundario sf="arrow.clockwise" alTocar={() => empezar(modoRef.current, nivelRef.current)}>Empezar de nuevo</BotonJuego>
                  <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={() => { setPausa(false); setFase('portada'); }}>Menú</BotonJuego>
                </View>
              </> : null}
              {fin?.tipo === 'gano' ? <>
                <Estrellas n={fin.estrellas} tam={34} />
                <Text style={estilos.panelTitulo}>¡Nivel {nivel} listo!</Text>
                <Text style={[textoAyuda, { textAlign: 'center' }]}>Te sobraron {sobran} {sobran === 1 ? 'movimiento' : 'movimientos'}.{fin.estrellas < 3 ? ' Con más movimientos de sobra ganas más estrellas.' : ''}</Text>
                <View style={{ alignSelf: 'stretch', gap: 10 }}>
                  <BotonJuego sf="arrow.right" alTocar={() => { const n = nivel + 1; setNivel(n); empezar('niveles', n); }}>Siguiente nivel</BotonJuego>
                  <BotonJuego secundario sf="arrow.clockwise" alTocar={() => empezar('niveles', nivel)}>Repetir</BotonJuego>
                  <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={() => setFase('portada')}>Menú</BotonJuego>
                </View>
              </> : null}
              {fin?.tipo === 'movs' || fin?.tipo === 'lleno' ? <>
                <Pieza sprites={chicas} tier={fin.tipo === 'movs' ? 1 : 8} tam={60} />
                <Text style={estilos.panelTitulo}>{fin.tipo === 'movs' ? '¡Casi!' : 'El botiquín se llenó'}</Text>
                <Text style={[textoAyuda, { textAlign: 'center' }]}>
                  {fin.tipo === 'movs'
                    ? `Se acabaron los movimientos. Llevabas ${Math.min(vista.creados, conf.cuantas)} de ${conf.cuantas}. Truco: une primero las parejas que ya están juntas.`
                    : 'No quedan parejas una al lado de la otra. Truco: deja espacio y junta las iguales en un rincón.'}
                </Text>
                <View style={{ alignSelf: 'stretch', gap: 10 }}>
                  <BotonJuego sf="arrow.clockwise" alTocar={() => empezar('niveles', nivel)}>Reintentar</BotonJuego>
                  <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={() => setFase('portada')}>Menú</BotonJuego>
                </View>
              </> : null}
              {fin?.tipo === 'relax' ? <>
                {fin.nuevoRecord ? (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 4, minHeight: 26, borderRadius: 13, justifyContent: 'center', backgroundColor: '#FFD86B' }}>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: '#3A2A00' }}>¡NUEVO RÉCORD!</Text>
                  </View>
                ) : null}
                <Text style={estilos.panelTitulo}>{entero(vista.puntos)} puntos</Text>
                <Text style={[textoAyuda, { textAlign: 'center' }]}>
                  El tablero se llenó. Llegaste hasta {ARTICULO[vista.max]} {NOMBRES[vista.max]}. Tu récord: {entero(record)}.
                </Text>
                <View style={{ alignSelf: 'stretch', gap: 10 }}>
                  <BotonJuego sf="arrow.clockwise" alTocar={() => empezar('relax', 1)}>Otra vez</BotonJuego>
                  <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={() => setFase('portada')}>Menú</BotonJuego>
                </View>
              </> : null}
            </PanelVidrio>
          </ScrollView>
        </Animated.View>
      ) : null}
    </Escena>
  );
}

const estilos = StyleSheet.create({
  titulo: { fontSize: 17, fontWeight: '800', color: BLANCO },
  panelTitulo: { fontSize: 22, fontWeight: '900', color: BLANCO, textAlign: 'center' },
  redondo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  nivel: { minWidth: 56, minHeight: 56, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 12, minHeight: 40, borderRadius: 20,
    backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  metaLista: { backgroundColor: 'rgba(60,210,150,0.35)', borderColor: 'rgba(140,255,200,0.6)' },
  metaTexto: { fontSize: 15, fontWeight: '800', color: BLANCO, fontVariant: ['tabular-nums'] },
  novedad: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 20, borderRadius: 24, maxWidth: '90%',
    backgroundColor: 'rgba(24,10,48,0.82)', borderWidth: 1, borderColor: 'rgba(255,216,107,0.6)' },
});
