// Botiquín (Bienestar). Medicamentos que caen en un botiquín: dos iguales que se
// tocan se juntan en el siguiente de la cadena, de la Pastilla a la Cruz de
// farmacia. Si algo queda asomado sobre el borde, se acaba.
//
// Tercera versión (2026-11-04). La primera se cerraba al iniciar (la física
// corría en el hilo de la interfaz) y la segunda, con un motor propio, el
// usuario la encontró «horrible, injugable». Ésta separa las tres cosas:
//   · la física es Matter.js (lib/botiquinMotor.js): las piezas ruedan, giran
//     y se acomodan como objetos de verdad;
//   · el arte es dibujo de verdad (scripts/botiquin/arte.mjs → PNG): once
//     piezas con cara, el estuche y una luz que no gira con la pieza;
//   · el cuadro lo pinta Skia en el hilo de la interfaz desde una foto de
//     números que JavaScript le pasa en cada cuadro.
// Antes de tocar la física o el arte, correr el banco de pruebas
// (scripts/botiquin/banco.mjs): juega solo en Chromium y saca capturas.
//
// Una falla del motor termina la partida y se reporta: nunca cierra la app.
// Con la pantalla fuera de vista o la app en segundo plano el reloj se para y
// al volver queda en pausa.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Canvas, PaintStyle, Picture, Skia, useImage } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { Confeti, Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { AvisoJuego, BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, PanelVidrio, VIDRIO, VIDRIO_BORDE, textoAyuda } from '../componentes/juegos/Escena';
import { ORO, TarjetaNivel } from '../componentes/juegos/Niveles';
import { entero } from '../lib/formato';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';
import { useVisible } from '../lib/visible';
import { reportarError } from '../lib/errores';
import {
  AVISO_PELIGRO, CAJA, MAX, PREMIO_CUMBRE, RADIOS, Y_SOLTAR, ZONA_ARRIBA,
  avanzar, crearMundo, destruir, piezas, puedeSoltar, soltar,
} from '../lib/botiquinMotor';

const CLAVE_RECORD = 'puntos_salud_botiquin_caida_record';
const CLAVE_MAYOR = 'puntos_salud_botiquin_caida_mayor';
const SONIDOS = ['gota', 'pop-1', 'pop-2', 'pop-3', 'pop-4', 'pop-5', 'pop-6', 'par', 'ganar', 'fallo', 'derrumbe'];

export const NOMBRES = ['Pastilla', 'Gragea', 'Perla', 'Gomita', 'Efervescente', 'Algodón', 'Tapa', 'Crema', 'Pastillero', 'Estetoscopio', 'Cruz de farmacia'];
const ARTICULO = ['la', 'la', 'la', 'la', 'la', 'el', 'la', 'la', 'el', 'el', 'la'];
// El color dominante de cada pieza: las chispas de una unión salen de ese color.
const TONOS = ['#BFD8FA', '#FF7DB5', '#FFD34F', '#A877FF', '#FFA04A', '#FFFFFF', '#4E93FF', '#5FE0B6', '#FFC66B', '#E3E8EF', '#9BE15D'];
const PELIGRO = '#FF6B7E';

const ARTE = [
  require('../assets/juegos/botiquin/pieza-0.png'),
  require('../assets/juegos/botiquin/pieza-1.png'),
  require('../assets/juegos/botiquin/pieza-2.png'),
  require('../assets/juegos/botiquin/pieza-3.png'),
  require('../assets/juegos/botiquin/pieza-4.png'),
  require('../assets/juegos/botiquin/pieza-5.png'),
  require('../assets/juegos/botiquin/pieza-6.png'),
  require('../assets/juegos/botiquin/pieza-7.png'),
  require('../assets/juegos/botiquin/pieza-8.png'),
  require('../assets/juegos/botiquin/pieza-9.png'),
  require('../assets/juegos/botiquin/pieza-10.png'),
];
const ARTE_BRILLO = require('../assets/juegos/botiquin/brillo.png');
const ARTE_FONDO = require('../assets/juegos/botiquin/caja-fondo.png');
const ARTE_FRENTE = require('../assets/juegos/botiquin/caja-frente.png');

// El mundo entero (estuche + aire de arriba) en unidades del motor.
const ANCHO_TOTAL = CAJA.ANCHO + CAJA.PARED * 2;
const ALTO_TOTAL = ZONA_ARRIBA + CAJA.ALTO + CAJA.PARED;

function medir(w, h) {
  if (!w || !h) return null;
  const k = Math.min(w / ANCHO_TOTAL, h / ALTO_TOTAL);
  return { w, h, k, ox: (w - ANCHO_TOTAL * k) / 2 + CAJA.PARED * k, oy: (h - ALTO_TOTAL * k) / 2 + ZONA_ARRIBA * k };
}

// Las imágenes de Skia: una por pieza, más la luz y las dos capas del estuche.
// Explícitas y no en un bucle: son hooks.
function useArte() {
  const p0 = useImage(ARTE[0]); const p1 = useImage(ARTE[1]); const p2 = useImage(ARTE[2]); const p3 = useImage(ARTE[3]);
  const p4 = useImage(ARTE[4]); const p5 = useImage(ARTE[5]); const p6 = useImage(ARTE[6]); const p7 = useImage(ARTE[7]);
  const p8 = useImage(ARTE[8]); const p9 = useImage(ARTE[9]); const p10 = useImage(ARTE[10]);
  const brillo = useImage(ARTE_BRILLO); const fondo = useImage(ARTE_FONDO); const frente = useImage(ARTE_FRENTE);
  return useMemo(() => {
    const lista = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];
    if (lista.some((x) => !x) || !brillo || !fondo || !frente) return null;
    const src = (i) => Skia.XYWHRect(0, 0, i.width(), i.height());
    return { piezas: lista, src: lista.map(src), brillo, srcBrillo: src(brillo), fondo, frente, srcCaja: src(fondo) };
  }, [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, brillo, fondo, frente]);
}

// La foto que cruza al hilo de la interfaz: sólo números. 5 por pieza (nivel,
// x, y, giro, radio), 5 por anillo (x, y, radio, nivel, avance) y 5 por chispa
// (x, y, radio, nivel, vida).
function fotografiar(m, chispas, mov, cuelga) {
  const lista = piezas(m);
  const c = new Array(lista.length * 5); let k = 0;
  for (const b of lista) {
    let r = b.circleRadius;
    // Un saltito al nacer de una unión (además de crecer en el motor).
    if (mov && b.plugin.junta) { const q = (m.t - b.plugin.nace) / 0.3; if (q > 0.35 && q < 1) r *= 1 + 0.08 * Math.sin(((q - 0.35) / 0.65) * Math.PI); }
    c[k++] = b.plugin.n; c[k++] = b.position.x; c[k++] = b.position.y; c[k++] = b.angle; c[k++] = r;
  }
  const a = [];
  if (mov) {
    for (const r of m.anillos) { const q = (m.t - r.t) / 0.55; if (q >= 0 && q < 1) a.push(r.x, r.y, r.r, r.n, q); }
  }
  const p = [];
  for (const s of chispas) p.push(s.x, s.y, s.r, s.n, s.vida);
  return { t: m.t, peligro: m.peligro, actual: m.actual, c, a, p, cuelga: cuelga && !m.perdio, lista: puedeSoltar(m) };
}

// ── Piezas sueltas de la interfaz (imágenes normales, nítidas) ────────────────
function PiezaImg({ n, tam, apagada = false }) {
  return <Image source={ARTE[n]} style={{ width: tam, height: tam, opacity: apagada ? 0.28 : 1 }} />;
}

// La cadena completa, de la más chica a la más grande: lo que falta, apagado.
function Cadena({ mayor, tam = 26 }) {
  return (
    <View style={estilos.cadena} accessible
      accessibilityLabel={`La cadena: ${NOMBRES.join(', ')}.${mayor != null ? ` Lo más grande que hiciste: ${NOMBRES[mayor]}.` : ''}`}>
      {NOMBRES.map((nombre, i) => (
        <View key={nombre} style={{ alignItems: 'center', justifyContent: 'center', width: tam, height: tam }}>
          <PiezaImg n={i} tam={tam * (0.62 + (i / MAX) * 0.38)} apagada={mayor != null && i > mayor} />
        </View>
      ))}
    </View>
  );
}

// Los puntos que flotan donde se hizo la unión.
function Flotante({ x, y, texto, grande, alTerminar }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(1, { duration: grande ? 1100 : 750, easing: Easing.out(Easing.cubic) }, (ok) => { if (ok) runOnJS(alTerminar)(); });
  }, [v, grande, alTerminar]);
  const estilo = useAnimatedStyle(() => ({
    opacity: v.value < 0.7 ? 1 : 1 - (v.value - 0.7) / 0.3,
    transform: [{ translateY: -v.value * (grande ? 70 : 44) }, { scale: 0.7 + Math.min(1, v.value * 4) * 0.3 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - 70, top: y - 18, width: 140, alignItems: 'center' }, estilo]}>
      <Text maxFontSizeMultiplier={1.2} style={[estilos.flotante, grande && { fontSize: 26, color: ORO }]}>{texto}</Text>
    </Animated.View>
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
  const visible = useVisible();
  const arte = useArte();
  const [fase, setFase] = useState('portada'); // portada · jugando · fin
  const [pausa, setPausa] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [record, setRecord] = useState(0);
  const [mayorHistorico, setMayorHistorico] = useState(null);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const [siguiente, setSiguiente] = useState(0);
  const [actual, setActual] = useState(0);
  const [mayor, setMayor] = useState(0);
  const [aviso, setAviso] = useState(null);
  const [festejo, setFestejo] = useState(0);
  const [caja, setCaja] = useState(null);
  const [flotantes, setFlotantes] = useState([]);
  const recordRef = useRef(0);
  const mayorHistRef = useRef(-1);
  const mayorRef = useRef(0);
  const racha = useRef({ n: 0, t: 0 });
  const mundo = useRef(null);
  const chispas = useRef([]);
  const idFlotante = useRef(0);

  // Lo que lee el dibujo, en el hilo de la interfaz.
  const foto = useSharedValue(null);
  const geoV = useSharedValue(null);
  const arteV = useSharedValue(null);
  const apunta = useSharedValue(CAJA.ANCHO / 2); // dónde se va a soltar, en unidades del mundo
  const enJuego = useSharedValue(false);
  const enJuegoRef = useRef(false);
  const animar = useSharedValue(!quieta);
  const animarRef = useRef(!quieta);
  useEffect(() => { animar.value = !quieta; animarRef.current = !quieta; }, [quieta, animar]);
  useEffect(() => { arteV.value = arte; }, [arte, arteV]);

  const geo = useMemo(() => (caja ? medir(caja.w, caja.h) : null), [caja]);
  useEffect(() => { geoV.value = geo; }, [geo, geoV]);

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE_RECORD).then((v) => { const n = Number(v) || 0; recordRef.current = n; setRecord(n); }).catch(() => {});
    SecureStore.getItemAsync(CLAVE_MAYOR).then((v) => { if (v != null && v !== '') { const n = Number(v); if (Number.isFinite(n)) { mayorHistRef.current = n; setMayorHistorico(n); } } }).catch(() => {});
    return () => { callar(SONIDOS); destruir(mundo.current); mundo.current = null; };
  }, []);

  const quitarFlotante = useCallback((id) => setFlotantes((l) => l.filter((f) => f.id !== id)), []);

  // ── Lo que pasa cuando el mundo avisa: sonido, vibración, marcador ──────────
  const js = useRef({});
  js.current.eventos = (evs, m) => {
    setPuntos(m.puntos);
    const ahora = Date.now();
    const g = geo;
    const nuevos = [];
    for (const e of evs) {
      racha.current = ahora - racha.current.t < 1100 ? { n: racha.current.n + 1, t: ahora } : { n: 1, t: ahora };
      if (animarRef.current) {
        // Chispas del color de la pieza nueva.
        const cuantas = e.tipo === 'cumbre' ? 26 : Math.round(8 + Math.min(10, e.n * 1.5));
        for (let i = 0; i < cuantas; i++) {
          const a = Math.random() * Math.PI * 2; const v = 90 + Math.random() * 160 + e.n * 12;
          chispas.current.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, r: 2.5 + Math.random() * 3 + e.n * 0.35, n: e.n, vida: 1 });
        }
      }
      if (g) nuevos.push({ id: idFlotante.current++, x: g.ox + e.x * g.k, y: g.oy + e.y * g.k, texto: `+${e.puntos}`, grande: e.tipo === 'cumbre' || e.n >= 7 });
      if (e.tipo === 'cumbre') {
        sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1);
        setAviso({ k: ahora, texto: `¡Dos cruces de farmacia! +${PREMIO_CUMBRE}` });
        continue;
      }
      sonar(`pop-${1 + (e.n % 6)}`, { tono: Math.max(0.62, 1.25 - e.n * 0.06), volumen: 0.85 });
      if (e.n >= 6) tacto.golpe(); else tacto.toque();
      if (e.n > mayorRef.current) {
        mayorRef.current = e.n; setMayor(e.n);
        if (e.n >= 5) {
          sonar('par', { volumen: 0.6 });
          setAviso({ k: ahora, texto: `¡${ARTICULO[e.n] === 'el' ? 'Tu primer' : 'Tu primera'} ${NOMBRES[e.n]}!` });
          if (e.n >= 8) setFestejo((k) => k + 1);
        }
      }
      if (racha.current.n >= 3) setAviso({ k: ahora + 1, texto: `¡Cadena ×${racha.current.n}!` });
    }
    if (nuevos.length) setFlotantes((l) => [...l.slice(-8), ...nuevos]);
  };
  js.current.peligro = (si) => {
    if (si) { sonar('fallo', { volumen: 0.5 }); tacto.aviso(); setAviso({ k: Date.now(), texto: '¡Cuidado, se desborda!' }); } else setAviso(null);
  };
  js.current.perder = (m) => {
    enJuegoRef.current = false; enJuego.value = false;
    setPuntos(m.puntos); setFase('fin'); setAviso(null);
    sonar('derrumbe'); tacto.aviso();
    if (m.mayor > mayorHistRef.current) { mayorHistRef.current = m.mayor; setMayorHistorico(m.mayor); SecureStore.setItemAsync(CLAVE_MAYOR, String(m.mayor)).catch(() => {}); }
    if (m.puntos > recordRef.current) {
      recordRef.current = m.puntos; setRecord(m.puntos); setNuevoRecord(true);
      SecureStore.setItemAsync(CLAVE_RECORD, String(m.puntos)).catch(() => {});
      setTimeout(() => { sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1); }, 700);
    }
  };

  const mostrar = (cuelga) => {
    if (mundo.current) foto.value = fotografiar(mundo.current, chispas.current, animarRef.current, cuelga);
  };

  // ── El reloj: requestAnimationFrame; el motor da pasos fijos de 1/120 s ─────
  const cuadroJs = useRef(null);
  cuadroJs.current = (dt) => {
    const m = mundo.current;
    if (!m || m.perdio) return;
    avanzar(m, dt);
    // Las chispas: caen y se apagan en ~0.6 s.
    if (chispas.current.length) {
      const d = Math.min(dt, 0.05);
      chispas.current = chispas.current.filter((s) => {
        s.vy += 600 * d; s.vx *= 0.985; s.x += s.vx * d; s.y += s.vy * d; s.vida -= d / 0.6;
        return s.vida > 0;
      });
    }
    if (m.eventos.length) { const evs = m.eventos; m.eventos = []; js.current.eventos(evs, m); }
    if (!m.alerta && m.peligro > AVISO_PELIGRO) { m.alerta = true; js.current.peligro(true); } else if (m.alerta && m.peligro === 0) { m.alerta = false; js.current.peligro(false); }
    mostrar(true);
    if (m.perdio) { mostrar(false); js.current.perder(m); }
  };
  const corriendo = fase === 'jugando' && !pausa && visible && !!geo && !!arte;
  useEffect(() => {
    enJuegoRef.current = corriendo; enJuego.value = corriendo;
    if (!corriendo) return undefined;
    let id = 0; let antes = 0; let vivo = true;
    const tic = (ahora) => {
      if (!vivo) return;
      const dt = antes ? (ahora - antes) / 1000 : 1 / 60;
      antes = ahora;
      try { cuadroJs.current(dt); } catch (err) {
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
  useEffect(() => { if (!visible && fase === 'jugando') setPausa(true); }, [visible, fase]);

  const empezar = useCallback(() => {
    destruir(mundo.current);
    const m = crearMundo((Date.now() % 2147483000) + 1);
    m.alerta = false;
    mundo.current = m;
    chispas.current = [];
    setPuntos(0); setMayor(0); mayorRef.current = 0; setNuevoRecord(false); setAviso(null); setPausa(false); setFlotantes([]);
    racha.current = { n: 0, t: 0 };
    apunta.value = CAJA.ANCHO / 2;
    foto.value = fotografiar(m, [], animarRef.current, true);
    setActual(m.actual); setSiguiente(m.siguiente);
    setFase('jugando');
  }, [apunta, foto]);

  js.current.soltarEn = (x) => {
    const m = mundo.current;
    if (!enJuegoRef.current || !m) return;
    const n = m.actual;
    const b = soltar(m, x);
    if (!b) return;
    setActual(m.actual); setSiguiente(m.siguiente);
    sonar('gota', { volumen: 0.45, tono: 1.3 - n * 0.07 });
    tacto.roce();
    mostrar(true);
  };
  const alSoltarEn = useCallback((x) => js.current.soltarEn(x), []);

  // El dedo se lee en el hilo de la interfaz: la pieza que cuelga lo sigue sin
  // esperar a JavaScript. Se suelta al levantar el dedo (arrastre o toque).
  const gesto = useMemo(() => {
    const aMundo = (px) => { 'worklet'; const g = geoV.value; return g ? Math.min(CAJA.ANCHO, Math.max(0, (px - g.ox) / g.k)) : CAJA.ANCHO / 2; };
    return Gesture.Pan().minDistance(0).maxPointers(1)
      .onBegin((e) => { apunta.value = aMundo(e.x); })
      .onUpdate((e) => { apunta.value = aMundo(e.x); })
      .onFinalize((e) => { const v = aMundo(e.x); apunta.value = v; runOnJS(alSoltarEn)(v); });
  }, [apunta, geoV, alSoltarEn]);

  // ── El cuadro: un solo Picture con todo ─────────────────────────────────────
  const cuadro = useDerivedValue(() => {
    const g = geoV.value; const im = arteV.value; const f = foto.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.w : 1, g ? g.h : 1));
    if (!g || !im) return rec.finishRecordingAsPicture();
    const k = g.k; const mov = animar.value;
    const X = (x) => g.ox + x * k; const Y = (y) => g.oy + y * k;
    const p = Skia.Paint(); p.setAntiAlias(true);
    const cajaRect = Skia.XYWHRect(X(-CAJA.PARED), Y(-CAJA.ARRIBA), ANCHO_TOTAL * k, (CAJA.ARRIBA + CAJA.ALTO + CAJA.PARED) * k);
    c.drawImageRect(im.fondo, im.srcCaja, cajaRect, p);
    const pieza = (n, x, y, ang, r) => {
      const R = r * k; const cx = X(x); const cy = Y(y);
      c.save(); c.translate(cx, cy);
      if (ang) c.rotate((ang * 180) / Math.PI, 0, 0);
      c.drawImageRect(im.piezas[n], im.src[n], Skia.XYWHRect(-R, -R, R * 2, R * 2), p);
      c.restore();
      // La luz no gira: queda arriba a la izquierda aunque la pieza ruede.
      c.drawImageRect(im.brillo, im.srcBrillo, Skia.XYWHRect(cx - R, cy - R, R * 2, R * 2), p);
    };

    if (f) {
      // La pieza que cuelga y su guía hasta el fondo.
      if (enJuego.value && f.cuelga) {
        const n = f.actual; const r = RADIOS[n];
        const x = Math.min(CAJA.ANCHO - r, Math.max(r, apunta.value));
        const guia = Skia.Paint(); guia.setColor(Skia.Color('#FFFFFF')); guia.setAlphaf(f.lista ? 0.22 : 0.08);
        const top = Y(Y_SOLTAR + r); const fin = Y(CAJA.ALTO);
        for (let y = top; y < fin; y += 14 * k) c.drawRect(Skia.XYWHRect(X(x) - 1, y, 2, Math.min(7 * k, fin - y)), guia);
        if (f.lista) pieza(n, x, Y_SOLTAR, 0, r);
      }
      const cs = f.c;
      for (let i = 0; i < cs.length; i += 5) pieza(cs[i], cs[i + 1], cs[i + 2], cs[i + 3], cs[i + 4]);

      if (mov) {
        // Anillo y chispas de cada unión.
        const aro = Skia.Paint(); aro.setAntiAlias(true); aro.setStyle(PaintStyle.Stroke);
        const an = f.a;
        for (let i = 0; i < an.length; i += 5) {
          const q = an[i + 4]; const nn = an[i + 3];
          aro.setColor(Skia.Color(nn === MAX ? ORO : '#FFFFFF'));
          aro.setAlphaf((1 - q) * 0.9);
          aro.setStrokeWidth((1.5 + 4 * (1 - q)) * k);
          c.drawCircle(X(an[i]), Y(an[i + 1]), an[i + 2] * k * (1 + 0.6 * q), aro);
        }
        const ch = Skia.Paint(); ch.setAntiAlias(true);
        const pp = f.p;
        for (let i = 0; i < pp.length; i += 5) {
          ch.setColor(Skia.Color(TONOS[pp[i + 3]]));
          ch.setAlphaf(Math.max(0, pp[i + 4]));
          c.drawCircle(X(pp[i]), Y(pp[i + 1]), pp[i + 2] * k * (0.5 + 0.5 * pp[i + 4]), ch);
        }
      }
    }
    c.drawImageRect(im.frente, im.srcCaja, cajaRect, p);

    // El borde: punteado; en rojo que late mientras algo se desborda.
    const linea = Skia.Paint(); linea.setAntiAlias(true);
    if (f && f.peligro > 0) {
      linea.setColor(Skia.Color(PELIGRO));
      linea.setAlphaf(mov ? 0.6 + 0.4 * Math.sin(f.t * 14) : 1);
    } else { linea.setColor(Skia.Color('#FFFFFF')); linea.setAlphaf(0.4); }
    const seg = 10 * k;
    for (let x = 0; x < CAJA.ANCHO * k; x += seg * 2) c.drawRect(Skia.XYWHRect(g.ox + x, g.oy - 1.5, Math.min(seg, CAJA.ANCHO * k - x), 3), linea);
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
    apunta.value = x * CAJA.ANCHO;
    js.current.soltarEn(x * CAJA.ANCHO);
  };

  return (
    <Escena colores={ESCENAS.botiquin} fijo estilo={{ gap: 8 }}>
      <ControlesSensaciones izquierda={<>
        <Marcador sf="trophy.fill" texto={entero(record)} etiqueta={`Récord: ${entero(record)} puntos`} />
        {jugando && !pausa ? <BotonChico sf="pause.fill" etiqueta="Pausar" alTocar={() => setPausa(true)} /> : null}
      </>} />

      {fase !== 'portada' ? (
        <View style={estilos.tablero}>
          <View accessible accessibilityLabel={`${entero(puntos)} puntos`}>
            <Text maxFontSizeMultiplier={1.2} style={estilos.rotulo}>PUNTOS</Text>
            <Text maxFontSizeMultiplier={1.2} style={estilos.puntos}>{entero(puntos)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 6 }}>
            <AvisoJuego clave={aviso?.k} texto={aviso?.texto} />
          </View>
          <View style={estilos.sigue} accessible accessibilityLabel={`Ahora cae: ${NOMBRES[actual]}. Después: ${NOMBRES[siguiente]}.`}>
            <Text maxFontSizeMultiplier={1.2} style={estilos.rotulo}>SIGUE</Text>
            <PiezaImg n={siguiente} tam={34} />
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1 }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (!caja || caja.w !== w || caja.h !== h) setCaja({ w, h }); }}>
        {geo && arte && fase !== 'portada' ? (
          <GestureDetector gesture={gesto}>
            <View style={{ flex: 1 }} accessible
              accessibilityLabel={`Botiquín. ${entero(puntos)} puntos. Ahora cae: ${NOMBRES[actual]}. Arrastra a los lados y suelta para dejarla caer.`}
              accessibilityActions={jugando && !pausa ? acciones : []} onAccessibilityAction={alAccion}>
              <Canvas style={{ flex: 1 }}>
                <Picture picture={cuadro} />
              </Canvas>
            </View>
          </GestureDetector>
        ) : null}

        {flotantes.map((f) => <Flotante key={f.id} {...f} alTerminar={() => quitarFlotante(f.id)} />)}

        {fase === 'portada' ? (
          <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                <PiezaImg n={1} tam={46} /><PiezaImg n={10} tam={96} /><PiezaImg n={4} tam={60} />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={estilos.titulo}>Botiquín</Text>
            </View>
            <PanelVidrio estilo={{ gap: 12 }}>
              <Text style={{ ...textoAyuda, textAlign: 'center' }}>
                Arrastra y suelta: el medicamento cae al botiquín. Dos iguales que se tocan se juntan en el siguiente. ¡Llega a la cruz de farmacia! Si algo se queda asomado sobre el borde, se acaba.
              </Text>
              <Cadena mayor={mayorHistorico} />
              {record ? <Text maxFontSizeMultiplier={1.3} style={{ ...textoAyuda, textAlign: 'center', fontWeight: '700' }}>Tu récord: {entero(record)} puntos</Text> : null}
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
          <Animated.View entering={FadeIn.delay(600).duration(400)} style={estilos.encima}>
            <TarjetaNivel insignia={nuevoRecord ? '¡NUEVO RÉCORD!' : null} titulo={`${entero(puntos)} puntos`}
              texto={`${nuevoRecord ? 'Tu mejor partida hasta ahora.' : `Tu récord es de ${entero(record)}.`} Lo más grande que hiciste: ${NOMBRES[mayor]}.`}>
              <Cadena mayor={mayor} tam={24} />
              <BotonJuego sf="arrow.clockwise" alTocar={empezar}>Jugar otra vez</BotonJuego>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', ORO, '#9BE15D', '#FF7DB5', '#4E93FF']} alTerminar={() => {}} /> : null}
      </View>

      {jugando ? <Cadena mayor={mayor} tam={24} /> : null}
    </Escena>
  );
}

const estilos = StyleSheet.create({
  redondo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  tablero: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  rotulo: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: BLANCO_2 },
  puntos: { fontSize: 30, fontWeight: '900', color: BLANCO, fontVariant: ['tabular-nums'], marginTop: -2 },
  sigue: { alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  cadena: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.18)', alignSelf: 'center' },
  flotante: { fontSize: 19, fontWeight: '900', color: BLANCO, textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  titulo: { fontSize: 30, fontWeight: '900', color: BLANCO, textAlign: 'center' },
  encima: { position: 'absolute', left: 0, right: 0, bottom: 8 },
});
