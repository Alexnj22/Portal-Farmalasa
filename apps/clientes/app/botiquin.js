// Botiquín (Bienestar). Medicamentos que caen en un botiquín: dos iguales que se
// tocan se juntan en el siguiente de la cadena, de la Tableta al Sello
// Farmasalud. Los gérmenes son lo malo: ocupan lugar, crecen solos y contagian;
// una unión de medicamentos que los toca los elimina, y el gel los limpia de un
// estallido. Si algo queda asomado sobre el borde, se acaba.
//
// Cuarta versión (2026-11-04). Historia corta, para no repetirla:
//   · la 1.ª se cerraba al iniciar (física en el hilo de la interfaz);
//   · la 2.ª, con motor propio de círculos, «injugable»;
//   · la 3.ª ya con Matter.js, pero todo redondo y con caras: «aún no se siente
//     premium… que parezcan pastillas… agregar cosas malas… el juego se hace
//     eterno… que se sienta más fluido».
// Ésta: cada pieza con su forma real (lib/botiquinMotor.js), arte de
// medicamentos con el logo de la casa (scripts/botiquin/arte.mjs → PNG con su
// sombra), gérmenes y gel, cadenas que multiplican, empujón y temblor en las
// uniones grandes, aplastamiento en los golpes.
//
// Antes de tocar la física, la dificultad o el arte: correr el banco de
// pruebas (scripts/botiquin/banco.mjs), que juega solo con el mismo motor y el
// mismo arte en Chromium y saca capturas. Ahí está calibrado que una partida
// dure ~4-5 minutos.
//
// Cómo se reparte el trabajo: el motor corre en JavaScript (requestAnimationFrame,
// pasos fijos) y en cada cuadro le pasa al hilo de la interfaz una foto de puros
// números; Skia la pinta en un solo Picture. Una falla del motor termina la
// partida y se reporta: nunca cierra la app.
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
  AVISO_PELIGRO, CAJA, FORMAS, GEL, GERMENES, IMG_GEL, IMG_GERMEN, MAX, Y_SOLTAR, ZONA_ARRIBA,
  avanzar, crearMundo, destruir, formaDe, imagenDe, medidas, piezas, puedeSoltar, soltar,
} from '../lib/botiquinMotor';

const CLAVE_RECORD = 'puntos_salud_botiquin_v4_record';
const CLAVE_MAYOR = 'puntos_salud_botiquin_v4_mayor';
const SONIDOS = ['gota', 'pop-1', 'pop-2', 'pop-3', 'pop-4', 'pop-5', 'pop-6', 'par', 'ganar', 'fallo', 'derrumbe', 'toque-1', 'toque-3', 'voltear'];

export const NOMBRES = ['Tableta', 'Gragea', 'Cápsula', 'Perla', 'Efervescente', 'Microgránulos', 'Blíster', 'Frasco', 'Caja', 'Botiquín', 'Sello Farmasalud'];
const ARTICULO = ['la', 'la', 'la', 'la', 'la', 'la', 'el', 'el', 'la', 'el', 'el'];
const nombreDe = (p) => (p.tipo === 'germen' ? 'Germen' : p.tipo === 'gel' ? 'Gel antibacterial' : NOMBRES[p.n]);
// El color dominante de cada imagen: las chispas salen de ese color.
const TONOS = ['#E9EFF8', '#FF6FAE', '#E53935', '#FFC83D', '#FF9A3D', '#12A39A', '#C9D3E0', '#E08A2E', '#8EC30F', '#B04BB0', '#F7C948', '#8FD13A', '#B65CE8', '#F05A44', '#7FD8FF'];
const PELIGRO = '#FF6B7E';

// Las imágenes, en el orden de `imagenDe`: medicamentos 0-10, gérmenes, gel.
const ARTE = [
  require('../assets/juegos/botiquin/pieza-0.png'), require('../assets/juegos/botiquin/pieza-1.png'),
  require('../assets/juegos/botiquin/pieza-2.png'), require('../assets/juegos/botiquin/pieza-3.png'),
  require('../assets/juegos/botiquin/pieza-4.png'), require('../assets/juegos/botiquin/pieza-5.png'),
  require('../assets/juegos/botiquin/pieza-6.png'), require('../assets/juegos/botiquin/pieza-7.png'),
  require('../assets/juegos/botiquin/pieza-8.png'), require('../assets/juegos/botiquin/pieza-9.png'),
  require('../assets/juegos/botiquin/pieza-10.png'),
  require('../assets/juegos/botiquin/germen-0.png'), require('../assets/juegos/botiquin/germen-1.png'),
  require('../assets/juegos/botiquin/germen-2.png'), require('../assets/juegos/botiquin/gel.png'),
];
const SOMBRAS = [
  require('../assets/juegos/botiquin/pieza-0-sombra.png'), require('../assets/juegos/botiquin/pieza-1-sombra.png'),
  require('../assets/juegos/botiquin/pieza-2-sombra.png'), require('../assets/juegos/botiquin/pieza-3-sombra.png'),
  require('../assets/juegos/botiquin/pieza-4-sombra.png'), require('../assets/juegos/botiquin/pieza-5-sombra.png'),
  require('../assets/juegos/botiquin/pieza-6-sombra.png'), require('../assets/juegos/botiquin/pieza-7-sombra.png'),
  require('../assets/juegos/botiquin/pieza-8-sombra.png'), require('../assets/juegos/botiquin/pieza-9-sombra.png'),
  require('../assets/juegos/botiquin/pieza-10-sombra.png'),
  require('../assets/juegos/botiquin/germen-0-sombra.png'), require('../assets/juegos/botiquin/germen-1-sombra.png'),
  require('../assets/juegos/botiquin/germen-2-sombra.png'), require('../assets/juegos/botiquin/gel-sombra.png'),
];
const ARTE_FONDO = require('../assets/juegos/botiquin/caja-fondo.png');
const ARTE_FRENTE = require('../assets/juegos/botiquin/caja-frente.png');

// Medidas sin girar de cada imagen, en unidades del mundo (las lee el dibujo).
const TODAS_LAS_FORMAS = [...FORMAS, ...GERMENES, GEL];
const ANCHOS = TODAS_LAS_FORMAS.map((f) => medidas(f).w);
const ALTOS = TODAS_LAS_FORMAS.map((f) => medidas(f).h);
const MARGEN_SOMBRA = 7; // el mismo de scripts/botiquin/render.mjs

const ANCHO_TOTAL = CAJA.ANCHO + CAJA.PARED * 2;
const ALTO_TOTAL = ZONA_ARRIBA + CAJA.ALTO + CAJA.PARED;

function medir(w, h) {
  if (!w || !h) return null;
  const k = Math.min(w / ANCHO_TOTAL, h / ALTO_TOTAL);
  return { w, h, k, ox: (w - ANCHO_TOTAL * k) / 2 + CAJA.PARED * k, oy: (h - ALTO_TOTAL * k) / 2 + ZONA_ARRIBA * k };
}

// Las imágenes de Skia. Es un bucle de hooks, pero de largo FIJO (las listas
// de arriba son constantes): el orden de las llamadas nunca cambia.
function useArte() {
  const piezasImg = ARTE.map((a) => useImage(a)); // eslint-disable-line react-hooks/rules-of-hooks
  const sombras = SOMBRAS.map((a) => useImage(a)); // eslint-disable-line react-hooks/rules-of-hooks
  const fondo = useImage(ARTE_FONDO); const frente = useImage(ARTE_FRENTE);
  const listo = piezasImg.every(Boolean) && sombras.every(Boolean) && fondo && frente;
  return useMemo(() => {
    if (!listo) return null;
    const src = (i) => Skia.XYWHRect(0, 0, i.width(), i.height());
    return { piezas: piezasImg, src: piezasImg.map(src), sombras, srcS: sombras.map(src), fondo, frente, srcCaja: src(fondo) };
  }, [listo, ...piezasImg, ...sombras, fondo, frente]); // eslint-disable-line react-hooks/exhaustive-deps
}

// La foto que cruza al hilo de la interfaz: sólo números. 6 por pieza (imagen,
// x, y, giro, escala, golpe), 5 por anillo (x, y, radio, clase, avance) y 5 por
// chispa (x, y, radio, imagen, vida).
function fotografiar(m, chispas, temblor, mov, cuelga) {
  const lista = piezas(m);
  const c = new Array(lista.length * 6); let k = 0;
  for (const b of lista) {
    const p = b.plugin;
    let e = p.esc;
    // Un saltito al terminar de crecer después de una unión.
    if (mov && p.junta) { const q = (m.t - p.nace - 0.12) / 0.22; if (q > 0 && q < 1) e *= 1 + 0.07 * Math.sin(q * Math.PI); }
    c[k++] = imagenDe(p); c[k++] = b.position.x; c[k++] = b.position.y; c[k++] = b.angle; c[k++] = e; c[k++] = mov ? p.golpe : 0;
  }
  const a = [];
  if (mov) for (const r of m.anillos) { const q = (m.t - r.t) / 0.55; if (q >= 0 && q < 1) a.push(r.x, r.y, r.r, r.n, q); }
  const p = [];
  for (const s of chispas) p.push(s.x, s.y, s.r, s.i, s.vida);
  return {
    t: m.t, peligro: m.peligro, actual: imagenDe(m.actual), c, a, p,
    cuelga: cuelga && !m.perdio, lista: puedeSoltar(m), dx: temblor.dx, dy: temblor.dy,
  };
}

// ── Piezas sueltas de la interfaz (imágenes normales, nítidas) ────────────────
function PiezaImg({ i, tam, apagada = false }) {
  const w = ANCHOS[i]; const h = ALTOS[i]; const e = tam / Math.max(w, h);
  return <Image source={ARTE[i]} style={{ width: w * e, height: h * e, opacity: apagada ? 0.25 : 1 }} />;
}

// La cadena completa, de la más chica a la más grande: lo que falta, apagado.
function Cadena({ mayor, tam = 28 }) {
  return (
    <View style={estilos.cadena} accessible
      accessibilityLabel={`La cadena: ${NOMBRES.join(', ')}.${mayor != null ? ` Lo más grande que hiciste: ${NOMBRES[mayor]}.` : ''}`}>
      {NOMBRES.map((nombre, i) => (
        <View key={nombre} style={{ alignItems: 'center', justifyContent: 'center', width: tam, height: tam }}>
          <PiezaImg i={i} tam={tam * (0.66 + (i / MAX) * 0.34)} apagada={mayor != null && i > mayor} />
        </View>
      ))}
    </View>
  );
}

// Los puntos que flotan donde pasó algo.
function Flotante({ x, y, texto, clase, alTerminar }) {
  const v = useSharedValue(0);
  const grande = clase === 'grande';
  useEffect(() => {
    v.value = withTiming(1, { duration: grande ? 1100 : 800, easing: Easing.out(Easing.cubic) }, (ok) => { if (ok) runOnJS(alTerminar)(); });
  }, [v, grande, alTerminar]);
  const estilo = useAnimatedStyle(() => ({
    opacity: v.value < 0.7 ? 1 : 1 - (v.value - 0.7) / 0.3,
    transform: [{ translateY: -v.value * (grande ? 70 : 46) }, { scale: 0.6 + Math.min(1, v.value * 5) * 0.4 }],
  }));
  const color = clase === 'limpia' ? '#C9F77A' : grande ? ORO : BLANCO;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - 80, top: y - 18, width: 160, alignItems: 'center' }, estilo]}>
      <Text maxFontSizeMultiplier={1.2} style={[estilos.flotante, { color }, grande && { fontSize: 27 }]}>{texto}</Text>
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
  const [cola, setCola] = useState({ actual: { tipo: 'med', n: 0 }, siguiente: { tipo: 'med', n: 0 } });
  const [mayor, setMayor] = useState(0);
  const [limpiados, setLimpiados] = useState(0);
  const [aviso, setAviso] = useState(null);
  const [festejo, setFestejo] = useState(0);
  const [caja, setCaja] = useState(null);
  const [flotantes, setFlotantes] = useState([]);
  const recordRef = useRef(0);
  const mayorHistRef = useRef(-1);
  const mayorRef = useRef(0);
  const mundo = useRef(null);
  const chispas = useRef([]);
  const temblor = useRef({ dx: 0, dy: 0, fuerza: 0 });
  const idFlotante = useRef(0);
  const ultimoAvisoMalo = useRef(0);

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
    setPuntos(m.puntos); setLimpiados(m.limpiados);
    const ahora = Date.now();
    const g = geo;
    const nuevos = [];
    const flota = (e, texto, clase) => { if (g) nuevos.push({ id: idFlotante.current++, x: g.ox + e.x * g.k, y: g.oy + e.y * g.k, texto, clase }); };
    const salpicar = (e, img, cuantas, fuerza) => {
      if (!animarRef.current) return;
      for (let i = 0; i < cuantas; i++) {
        const a = Math.random() * Math.PI * 2; const v = (80 + Math.random() * 170) * fuerza;
        chispas.current.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, r: 2.2 + Math.random() * 3.2 * fuerza, i: img, vida: 1 });
      }
      if (chispas.current.length > 160) chispas.current.splice(0, chispas.current.length - 160);
    };
    const sacudir = (f) => { if (animarRef.current) temblor.current.fuerza = Math.max(temblor.current.fuerza, f); };
    for (const e of evs) {
      if (e.tipo === 'golpe') { if (e.fuerza > 0.5) { sonar('toque-1', { volumen: 0.25 + e.fuerza * 0.3, tono: 0.7 }); tacto.roce(); } continue; }
      if (e.tipo === 'limpia') {
        salpicar(e, IMG_GERMEN + e.n, 10, 0.9);
        flota(e, `+${e.puntos}`, 'limpia');
        sonar('voltear', { volumen: 0.7, tono: 1.3 });
        continue;
      }
      if (e.tipo === 'gel') {
        salpicar(e, IMG_GEL, 22, 1.3); sacudir(4);
        sonar('ganar', { volumen: 0.6, tono: 1.2 }); tacto.exito();
        setAviso({ k: ahora, texto: e.limpiados ? `¡Limpieza! ${e.limpiados} ${e.limpiados === 1 ? 'germen menos' : 'gérmenes menos'}` : 'El gel no alcanzó ningún germen' });
        continue;
      }
      if (e.tipo === 'germen' || e.tipo === 'contagio') {
        salpicar(e, IMG_GERMEN + e.n, 6, 0.7);
        if (ahora - ultimoAvisoMalo.current > 2500) {
          ultimoAvisoMalo.current = ahora;
          sonar('fallo', { volumen: 0.45, tono: 0.8 }); tacto.aviso();
          setAviso({ k: ahora, texto: e.tipo === 'contagio' ? '¡Contagio! Apareció otro germen' : '¡Los gérmenes crecen!' });
        }
        continue;
      }
      // Una unión de medicamentos (o la cumbre).
      const cumbre = e.tipo === 'cumbre';
      salpicar(e, e.n, cumbre ? 40 : Math.round(8 + Math.min(14, e.n * 1.6)), cumbre ? 1.8 : 1 + e.n * 0.06);
      if (e.n >= 6 || cumbre) sacudir(cumbre ? 9 : 2 + (e.n - 5) * 1.2);
      flota(e, e.racha > 1 ? `+${e.puntos} ×${Math.min(3, 1 + (e.racha - 1) * 0.5)}` : `+${e.puntos}`, cumbre || e.n >= 7 ? 'grande' : 'normal');
      if (cumbre) {
        sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1);
        setAviso({ k: ahora, texto: `¡Dos sellos Farmasalud! +${e.puntos}` });
        continue;
      }
      sonar(`pop-${1 + (e.n % 6)}`, { tono: Math.max(0.6, 1.3 - e.n * 0.065), volumen: 0.85 });
      if (e.n >= 6) tacto.golpe(); else tacto.toque();
      if (e.n > mayorRef.current) {
        mayorRef.current = e.n; setMayor(e.n);
        if (e.n >= 5) {
          sonar('par', { volumen: 0.6 });
          setAviso({ k: ahora, texto: `¡${ARTICULO[e.n] === 'el' ? 'Tu primer' : 'Tu primera'} ${NOMBRES[e.n]}!` });
          if (e.n >= 8) setFestejo((k) => k + 1);
          continue;
        }
      }
      if (e.racha >= 3) setAviso({ k: ahora + 1, texto: `¡Cadena ×${e.racha}!` });
    }
    if (nuevos.length) setFlotantes((l) => [...l.slice(-10), ...nuevos]);
  };
  js.current.peligro = (si) => {
    if (si) { sonar('fallo', { volumen: 0.5 }); tacto.aviso(); setAviso({ k: Date.now(), texto: '¡Cuidado, se desborda!' }); } else setAviso(null);
  };
  js.current.perder = (m) => {
    enJuegoRef.current = false; enJuego.value = false;
    setPuntos(m.puntos); setLimpiados(m.limpiados); setFase('fin'); setAviso(null);
    sonar('derrumbe'); tacto.aviso();
    if (m.mayor > mayorHistRef.current) { mayorHistRef.current = m.mayor; setMayorHistorico(m.mayor); SecureStore.setItemAsync(CLAVE_MAYOR, String(m.mayor)).catch(() => {}); }
    if (m.puntos > recordRef.current) {
      recordRef.current = m.puntos; setRecord(m.puntos); setNuevoRecord(true);
      SecureStore.setItemAsync(CLAVE_RECORD, String(m.puntos)).catch(() => {});
      setTimeout(() => { sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1); }, 700);
    }
  };

  const mostrar = (cuelga) => {
    if (mundo.current) foto.value = fotografiar(mundo.current, chispas.current, temblor.current, animarRef.current, cuelga);
  };

  // ── El reloj: requestAnimationFrame; el motor da pasos fijos de 1/120 s ─────
  const cuadroJs = useRef(null);
  cuadroJs.current = (dt) => {
    const m = mundo.current;
    if (!m || m.perdio) return;
    avanzar(m, dt);
    const d = Math.min(dt, 0.05);
    // Las chispas caen y se apagan en ~0.6 s.
    if (chispas.current.length) {
      chispas.current = chispas.current.filter((s) => {
        s.vy += 650 * d; s.vx *= 0.985; s.x += s.vx * d; s.y += s.vy * d; s.vida -= d / 0.65;
        return s.vida > 0;
      });
    }
    // El temblor: se apaga solo en ~0.3 s.
    const tb = temblor.current;
    if (tb.fuerza > 0.2) { tb.fuerza *= Math.pow(0.0005, d); tb.dx = (Math.random() - 0.5) * tb.fuerza; tb.dy = (Math.random() - 0.5) * tb.fuerza; } else { tb.fuerza = 0; tb.dx = 0; tb.dy = 0; }
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
    temblor.current = { dx: 0, dy: 0, fuerza: 0 };
    setPuntos(0); setMayor(0); mayorRef.current = 0; setLimpiados(0); setNuevoRecord(false); setAviso(null); setPausa(false); setFlotantes([]);
    apunta.value = CAJA.ANCHO / 2;
    foto.value = fotografiar(m, [], temblor.current, animarRef.current, true);
    setCola({ actual: m.actual, siguiente: m.siguiente });
    setFase('jugando');
  }, [apunta, foto]);

  js.current.soltarEn = (x) => {
    const m = mundo.current;
    if (!enJuegoRef.current || !m) return;
    const pieza = m.actual;
    const b = soltar(m, x);
    if (!b) return;
    setCola({ actual: m.actual, siguiente: m.siguiente });
    if (pieza.tipo === 'gel') sonar('gota', { volumen: 0.5, tono: 1.5 });
    else if (pieza.tipo === 'germen') sonar('gota', { volumen: 0.4, tono: 0.7 });
    else sonar('gota', { volumen: 0.45, tono: 1.3 - pieza.n * 0.07 });
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
    if (f && (f.dx || f.dy)) { c.save(); c.translate(f.dx * k, f.dy * k); }
    const cajaRect = Skia.XYWHRect(X(-CAJA.PARED), Y(-CAJA.ARRIBA), ANCHO_TOTAL * k, (CAJA.ARRIBA + CAJA.ALTO + CAJA.PARED) * k);
    c.drawImageRect(im.fondo, im.srcCaja, cajaRect, p);
    // Una figura: su sombra (corrida hacia abajo, sin girar el corrimiento) o
    // ella misma. El golpe la aplasta un instante en vertical.
    const figura = (sombra, i, x, y, ang, e, golpe) => {
      const w = ANCHOS[i] * e * k; const h = ALTOS[i] * e * k;
      c.save(); c.translate(X(x), Y(y) + (sombra ? 3.5 * k : 0));
      if (golpe > 0.02) c.scale(1 + 0.11 * golpe, 1 - 0.11 * golpe);
      if (ang) c.rotate((ang * 180) / Math.PI, 0, 0);
      if (sombra) {
        const M = MARGEN_SOMBRA * e * k;
        c.drawImageRect(im.sombras[i], im.srcS[i], Skia.XYWHRect(-w / 2 - M, -h / 2 - M, w + M * 2, h + M * 2), p);
      } else c.drawImageRect(im.piezas[i], im.src[i], Skia.XYWHRect(-w / 2, -h / 2, w, h), p);
      c.restore();
    };

    if (f) {
      // La pieza que cuelga y su guía hasta el fondo.
      if (enJuego.value && f.cuelga) {
        const i = f.actual; const mitad = ANCHOS[i] / 2;
        const x = Math.min(CAJA.ANCHO - mitad, Math.max(mitad, apunta.value));
        const guia = Skia.Paint(); guia.setColor(Skia.Color('#FFFFFF')); guia.setAlphaf(f.lista ? 0.25 : 0.08);
        const top = Y(Y_SOLTAR + ALTOS[i] / 2); const fin = Y(CAJA.ALTO);
        for (let y = top; y < fin; y += 14 * k) c.drawRect(Skia.XYWHRect(X(x) - 1, y, 2, Math.min(7 * k, fin - y)), guia);
        if (f.lista) { figura(true, i, x, Y_SOLTAR, 0, 1, 0); figura(false, i, x, Y_SOLTAR, 0, 1, 0); }
      }
      const cs = f.c;
      for (let j = 0; j < cs.length; j += 6) figura(true, cs[j], cs[j + 1], cs[j + 2], cs[j + 3], cs[j + 4], cs[j + 5]);
      for (let j = 0; j < cs.length; j += 6) figura(false, cs[j], cs[j + 1], cs[j + 2], cs[j + 3], cs[j + 4], cs[j + 5]);

      if (mov) {
        // Anillo de cada unión: blanco; dorado la cumbre; verde la limpieza de un
        // germen; celeste el estallido del gel.
        const aro = Skia.Paint(); aro.setAntiAlias(true); aro.setStyle(PaintStyle.Stroke);
        const an = f.a;
        for (let j = 0; j < an.length; j += 5) {
          const q = an[j + 4]; const cl = an[j + 3];
          aro.setColor(Skia.Color(cl === MAX ? ORO : cl === -1 ? '#C9F77A' : cl === -2 ? '#7FD8FF' : '#FFFFFF'));
          aro.setAlphaf((1 - q) * 0.9);
          aro.setStrokeWidth((1.5 + 5 * (1 - q)) * k);
          c.drawCircle(X(an[j]), Y(an[j + 1]), an[j + 2] * k * (1 + (cl === -2 ? 1.4 : 0.6) * q), aro);
        }
        const ch = Skia.Paint(); ch.setAntiAlias(true);
        const pp = f.p;
        for (let j = 0; j < pp.length; j += 5) {
          ch.setColor(Skia.Color(TONOS[pp[j + 3]]));
          ch.setAlphaf(Math.max(0, pp[j + 4]));
          c.drawCircle(X(pp[j]), Y(pp[j + 1]), pp[j + 2] * k * (0.45 + 0.55 * pp[j + 4]), ch);
        }
      }
    }
    c.drawImageRect(im.frente, im.srcCaja, cajaRect, p);

    // El borde: punteado; en rojo que late mientras algo se desborda.
    const linea = Skia.Paint(); linea.setAntiAlias(true);
    if (f && f.peligro > 0) {
      linea.setColor(Skia.Color(PELIGRO));
      linea.setAlphaf(mov ? 0.6 + 0.4 * Math.sin(f.t * 14) : 1);
      // y un velo rojo que crece con el tiempo que lleva asomado
      const velo = Skia.Paint(); velo.setColor(Skia.Color(PELIGRO)); velo.setAlphaf(Math.min(0.22, f.peligro * 0.12));
      c.drawRect(Skia.XYWHRect(g.ox, g.oy, CAJA.ANCHO * k, 26 * k), velo);
    } else { linea.setColor(Skia.Color('#FFFFFF')); linea.setAlphaf(0.4); }
    const seg = 10 * k;
    for (let x = 0; x < CAJA.ANCHO * k; x += seg * 2) c.drawRect(Skia.XYWHRect(g.ox + x, g.oy - 1.5, Math.min(seg, CAJA.ANCHO * k - x), 3), linea);
    if (f && (f.dx || f.dy)) c.restore();
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
  const imgActual = imagenDe(cola.actual); const imgSiguiente = imagenDe(cola.siguiente);

  return (
    <Escena colores={ESCENAS.botiquin} fijo estilo={{ gap: 8 }}>
      <ControlesSensaciones izquierda={<>
        <Marcador sf="trophy.fill" texto={entero(record)} etiqueta={`Récord: ${entero(record)} puntos`} />
        {jugando && !pausa ? <BotonChico sf="pause.fill" etiqueta="Pausar" alTocar={() => setPausa(true)} /> : null}
      </>} />

      {fase !== 'portada' ? (
        <View style={estilos.tablero}>
          <View accessible accessibilityLabel={`${entero(puntos)} puntos`} style={{ minWidth: 90 }}>
            <Text maxFontSizeMultiplier={1.2} style={estilos.rotulo}>PUNTOS</Text>
            <Text maxFontSizeMultiplier={1.2} style={estilos.puntos}>{entero(puntos)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4 }}>
            <AvisoJuego clave={aviso?.k} texto={aviso?.texto} />
          </View>
          <View style={estilos.sigue} accessible accessibilityLabel={`Ahora cae: ${nombreDe(cola.actual)}. Después: ${nombreDe(cola.siguiente)}.`}>
            <Text maxFontSizeMultiplier={1.2} style={estilos.rotulo}>SIGUE</Text>
            <View style={{ width: 40, height: 34, alignItems: 'center', justifyContent: 'center' }}><PiezaImg i={imgSiguiente} tam={36} /></View>
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1 }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (!caja || caja.w !== w || caja.h !== h) setCaja({ w, h }); }}>
        {geo && arte && fase !== 'portada' ? (
          <GestureDetector gesture={gesto}>
            <View style={{ flex: 1 }} accessible
              accessibilityLabel={`Botiquín. ${entero(puntos)} puntos. Ahora cae: ${nombreDe(cola.actual)}. Arrastra a los lados y suelta para dejarla caer.`}
              accessibilityActions={jugando && !pausa ? acciones : []} onAccessibilityAction={alAccion}>
              <Canvas style={{ flex: 1 }}>
                <Picture picture={cuadro} />
              </Canvas>
            </View>
          </GestureDetector>
        ) : null}

        {flotantes.map((f) => <Flotante key={f.id} {...f} alTerminar={() => quitarFlotante(f.id)} />)}

        {fase === 'portada' ? (
          <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <PiezaImg i={2} tam={56} /><PiezaImg i={MAX} tam={92} /><PiezaImg i={7} tam={66} />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={estilos.titulo}>Botiquín</Text>
            </View>
            <PanelVidrio estilo={{ gap: 12 }}>
              <Text style={{ ...textoAyuda, textAlign: 'center' }}>
                Arrastra y suelta. Dos medicamentos iguales que se tocan se juntan en el siguiente: ¡llega al sello Farmasalud!
              </Text>
              <Cadena mayor={mayorHistorico} />
              <View style={estilos.fila}>
                <PiezaImg i={IMG_GERMEN} tam={30} />
                <Text style={[textoAyuda, { flex: 1 }]}>Los gérmenes crecen y contagian. Elimínalos con una unión que los toque…</Text>
              </View>
              <View style={estilos.fila}>
                <PiezaImg i={IMG_GEL} tam={30} />
                <Text style={[textoAyuda, { flex: 1 }]}>…o tírales gel: estalla y limpia los de alrededor.</Text>
              </View>
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
              texto={`${nuevoRecord ? 'Tu mejor partida hasta ahora.' : `Tu récord es de ${entero(record)}.`} Lo más grande: ${NOMBRES[mayor]}. Gérmenes eliminados: ${entero(limpiados)}.`}>
              <Cadena mayor={mayor} tam={26} />
              <BotonJuego sf="arrow.clockwise" alTocar={empezar}>Jugar otra vez</BotonJuego>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', ORO, '#8EC30F', '#981D97', '#FF6FAE']} alTerminar={() => {}} /> : null}
      </View>

      {jugando ? (
        <View accessible accessibilityLabel={`Ahora cae: ${nombreDe(cola.actual)}`} style={{ display: 'none' }}>
          <PiezaImg i={imgActual} tam={1} />
        </View>
      ) : null}
      {jugando ? <Cadena mayor={mayor} tam={26} /> : null}
    </Escena>
  );
}

const estilos = StyleSheet.create({
  redondo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  tablero: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  rotulo: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: BLANCO_2 },
  puntos: { fontSize: 30, fontWeight: '900', color: BLANCO, fontVariant: ['tabular-nums'], marginTop: -2 },
  sigue: { alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  cadena: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.2)', alignSelf: 'center' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flotante: { fontSize: 19, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  titulo: { fontSize: 30, fontWeight: '900', color: BLANCO, textAlign: 'center' },
  encima: { position: 'absolute', left: 0, right: 0, bottom: 8 },
});
