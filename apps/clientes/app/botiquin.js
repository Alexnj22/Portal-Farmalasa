// Botiquín (Bienestar). Medicamentos que caen en un botiquín: dos iguales que se
// tocan se juntan en el siguiente de la cadena, de la Tableta al Sello
// Farmasalud. Los gérmenes son lo malo: ocupan lugar, crecen solos y contagian;
// una unión de medicamentos que los toca los elimina, y el gel los limpia de un
// estallido. Si algo queda asomado sobre el borde, se acaba.
//
// Quinta versión (2026-11-04). Historia corta, para no repetirla:
//   · la 1.ª se cerraba al iniciar (física en el hilo de la interfaz);
//   · la 2.ª, con motor propio de círculos, «injugable»;
//   · la 3.ª ya con Matter.js, pero todo redondo y con caras;
//   · la 4.ª con formas reales: «se ve low cost… hasta pena me da».
// Ésta salió de un prototipo HTML que el usuario aprobó ANTES de construirla:
// logo original de la casa, un destello propio por pieza, tema claro u oscuro
// según el teléfono, 12 niveles con piezas contadas y más dificultad, y «wow
// visualmente sin afectar el rendimiento».
//
// Cómo se reparte el trabajo: el motor (lib/botiquinMotor.js) y los efectos
// (lib/botiquinEfectos.js) corren en JavaScript, y en cada cuadro le pasan al
// hilo de la interfaz una foto de puros números; Skia la pinta en un solo
// Picture. El estuche se pinta UNA vez por tamaño y tema (otro Picture) y las
// partículas tienen tope: el costo por cuadro no crece con la partida. Una
// falla del motor termina la partida y se reporta: nunca cierra la app.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { BlendMode, BlurStyle, Canvas, ClipOp, PaintStyle, Picture, Skia, StrokeCap, TileMode, useImage } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { Confeti, Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { AvisoJuego, BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, PanelVidrio, VIDRIO, VIDRIO_BORDE, textoAyuda } from '../componentes/juegos/Escena';
import { ORO, SelectorNiveles, TarjetaNivel, useProgreso } from '../componentes/juegos/Niveles';
import { entero } from '../lib/formato';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';
import { useVisible } from '../lib/visible';
import { reportarError } from '../lib/errores';
import {
  AVISO_PELIGRO, CAJA, CONF_LIBRE, IMG_GEL, IMG_GERMEN, MAX, NIVELES, Y_SOLTAR, ZONA_ARRIBA,
  avance, avanzar, confDeNivel, crearMundo, destruir, estrellasDe, imagenDe, puedeSoltar, soltar,
} from '../lib/botiquinMotor';
import {
  COLORES, DIBUJO, FORMA, ambiente, avanzarEfectos, crearEfectos, efectoDe, fotoEfectos, fotoPiezas, lanzamiento,
} from '../lib/botiquinEfectos';

const CLAVE_RECORD = 'puntos_salud_botiquin_v4_record';
const CLAVE_MAYOR = 'puntos_salud_botiquin_v4_mayor';
const CLAVE_NIVEL = 'puntos_salud_botiquin_v5_nivel';
const CLAVE_ESTRELLAS = 'puntos_salud_botiquin_v5_estrellas';
const SONIDOS = ['gota', 'pop-1', 'pop-2', 'pop-3', 'pop-4', 'pop-5', 'pop-6', 'par', 'ganar', 'fallo', 'derrumbe', 'toque-1', 'toque-3', 'voltear'];

export const NOMBRES = ['Tableta', 'Gragea', 'Cápsula', 'Perla', 'Efervescente', 'Microgránulos', 'Blíster', 'Frasco', 'Caja', 'Botiquín', 'Sello Farmasalud'];
const ARTICULO = ['la', 'la', 'la', 'la', 'la', 'los', 'el', 'el', 'la', 'el', 'el'];
const UN = ['una', 'una', 'una', 'una', 'una', 'unos', 'un', 'un', 'una', 'un', 'el'];
const nombreDe = (p) => (p.tipo === 'germen' ? 'Germen' : p.tipo === 'gel' ? 'Gel antibacterial' : NOMBRES[p.n]);
const textoMeta = (mt) => (mt.tipo === 'pieza' ? `Forma ${UN[mt.n]} ${NOMBRES[mt.n]}` : mt.tipo === 'limpiar' ? `Elimina ${mt.n} gérmenes` : mt.tipo === 'cadena' ? `Haz una cadena ×${mt.n}` : `Llega a ${entero(mt.n)} puntos`);
const metaCorta = (mt) => (mt.tipo === 'pieza' ? NOMBRES[mt.n] : mt.tipo === 'limpiar' ? `${mt.n} gérmenes` : mt.tipo === 'cadena' ? `Cadena ×${mt.n}` : `${entero(mt.n)} pts`);
const iconoMeta = (mt) => (mt.tipo === 'pieza' ? mt.n : mt.tipo === 'limpiar' ? IMG_GERMEN : mt.tipo === 'cadena' ? 4 : MAX);

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
const ARTE_LOGO = require('../assets/juegos/botiquin/logo.png');

const ANCHOS = DIBUJO.map((d) => d.w);
const ALTOS = DIBUJO.map((d) => d.h);
const MARGEN_SOMBRA = 7; // el mismo de scripts/botiquin/render.mjs
const RADIO_GERMEN = [19, 28, 38];
const F_PUNTO = FORMA.punto; const F_ESTRELLA = FORMA.estrella; const F_BURBUJA = FORMA.burbuja; const F_CHISPA = FORMA.chispa;
const F_CUADRO = FORMA.cuadro; const F_CRUZ = FORMA.cruz; const F_BABA = FORMA.baba; const F_GOTA = FORMA.gota;
const F_ESPORA = FORMA.espora; const F_HUMO = FORMA.humo; const F_DESTELLO = FORMA.destello;
const I_ROJO = COLORES.indexOf('#E0412B');
const I_ROJO_VIVO = COLORES.indexOf('#F03C28');
const ESTILO_GERMEN = [COLORES.indexOf('#8FD13A'), COLORES.indexOf('#B65CE8'), COLORES.indexOf('#F05A44')];
// Las chispitas que orbitan la pieza que cuelga: el primer color de su estilo.
const ORBITA = [0, 2, 4, 5, 7, 8, 12, 13, 14, 15, 16, 18, 20, 22, 24];

// Opción A (claro) y B (noche), según el tema del teléfono — usuario, 2026-11-04.
// En claro el fondo de la escena sigue siendo de color: los controles comunes de
// los juegos son de vidrio con texto blanco y en un fondo pálido no se leerían.
const ESCENA_CLARA = ['#168276', '#2FA38D', '#79B83A'];

// Por encima del estuche queda el aire de la pieza que cuelga.
const ANCHO_TOTAL = CAJA.ANCHO + 28;
const ALTO_TOTAL = ZONA_ARRIBA + CAJA.ALTO + 16;
function medir(w, h) {
  if (!w || !h) return null;
  const k = Math.min(w / ANCHO_TOTAL, h / ALTO_TOTAL);
  return { w, h, k, ox: (w - ANCHO_TOTAL * k) / 2 + 14 * k, oy: (h - ALTO_TOTAL * k) / 2 + ZONA_ARRIBA * k };
}

// Las imágenes de Skia. Es un bucle de hooks, pero de largo FIJO (las listas
// de arriba son constantes): el orden de las llamadas nunca cambia.
function useArte() {
  const piezasImg = ARTE.map((a) => useImage(a)); // eslint-disable-line react-hooks/rules-of-hooks
  const sombras = SOMBRAS.map((a) => useImage(a)); // eslint-disable-line react-hooks/rules-of-hooks
  const logo = useImage(ARTE_LOGO);
  const listo = piezasImg.every(Boolean) && sombras.every(Boolean) && logo;
  return useMemo(() => {
    if (!listo) return null;
    const src = (i) => Skia.XYWHRect(0, 0, i.width(), i.height());
    return { piezas: piezasImg, src: piezasImg.map(src), sombras, srcS: sombras.map(src), logo, srcLogo: src(logo) };
  }, [listo, ...piezasImg, ...sombras, logo]); // eslint-disable-line react-hooks/exhaustive-deps
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
    v.value = withTiming(1, { duration: grande ? 1100 : 850, easing: Easing.out(Easing.cubic) }, (ok) => { if (ok) runOnJS(alTerminar)(); });
  }, [v, grande, alTerminar]);
  const estilo = useAnimatedStyle(() => ({
    opacity: v.value < 0.7 ? 1 : 1 - (v.value - 0.7) / 0.3,
    // Entra grande y se asienta: 0.5 → 1.15 → 1.
    transform: [{ translateY: -v.value * (grande ? 70 : 46) }, { scale: v.value < 0.15 ? 0.5 + (v.value / 0.15) * 0.65 : v.value < 0.25 ? 1.15 - ((v.value - 0.15) / 0.1) * 0.15 : 1 }],
  }));
  const color = clase === 'limpia' ? '#C9F77A' : clase === 'racha' ? '#F3A6F2' : grande ? ORO : BLANCO;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - 80, top: y - 18, width: 160, alignItems: 'center' }, estilo]}>
      <Text maxFontSizeMultiplier={1.2} style={[estilos.flotante, { color }, grande && { fontSize: 28 }]}>{texto}</Text>
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
  const noche = useColorScheme() !== 'light';
  const progreso = useProgreso(CLAVE_NIVEL, CLAVE_ESTRELLAS);
  const [fase, setFase] = useState('portada'); // portada · jugando · fin · gano
  const [nivel, setNivel] = useState(null); // null = juego libre; 1..N = nivel
  const [resultado, setResultado] = useState(null);
  const [pausa, setPausa] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [record, setRecord] = useState(0);
  const [mayorHistorico, setMayorHistorico] = useState(null);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const [cola, setCola] = useState({ actual: { tipo: 'med', n: 0 }, siguiente: { tipo: 'med', n: 0 } });
  const [mayor, setMayor] = useState(0);
  const [limpiados, setLimpiados] = useState(0);
  const [marcha, setMarcha] = useState({ avance: 0, quedan: 0, motivo: null });
  const [aviso, setAviso] = useState(null);
  const [festejo, setFestejo] = useState(0);
  const [caja, setCaja] = useState(null);
  const [flotantes, setFlotantes] = useState([]);
  const recordRef = useRef(0);
  const mayorHistRef = useRef(-1);
  const mayorRef = useRef(0);
  const nivelRef = useRef(null);
  const mundo = useRef(null);
  const fx = useRef(crearEfectos());
  const idFlotante = useRef(0);
  const ultimoAvisoMalo = useRef(0);

  // Lo que lee el dibujo, en el hilo de la interfaz.
  const foto = useSharedValue(null);
  const geoV = useSharedValue(null);
  const arteV = useSharedValue(null);
  const nocheV = useSharedValue(noche);
  const apunta = useSharedValue(CAJA.ANCHO / 2); // dónde se va a soltar, en unidades del mundo
  const enJuego = useSharedValue(false);
  const enJuegoRef = useRef(false);
  const animar = useSharedValue(!quieta);
  const animarRef = useRef(!quieta);
  useEffect(() => { animar.value = !quieta; animarRef.current = !quieta; fx.current.quieto = quieta; }, [quieta, animar]);
  useEffect(() => { arteV.value = arte; }, [arte, arteV]);
  useEffect(() => { nocheV.value = noche; fx.current.oscuro = noche; }, [noche, nocheV]);

  const geo = useMemo(() => (caja ? medir(caja.w, caja.h) : null), [caja]);
  useEffect(() => { geoV.value = geo; }, [geo, geoV]);

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE_RECORD).then((v) => { const n = Number(v) || 0; recordRef.current = n; setRecord(n); }).catch(() => {});
    SecureStore.getItemAsync(CLAVE_MAYOR).then((v) => { if (v != null && v !== '') { const n = Number(v); if (Number.isFinite(n)) { mayorHistRef.current = n; setMayorHistorico(n); } } }).catch(() => {});
    return () => { callar(SONIDOS); destruir(mundo.current); mundo.current = null; };
  }, []);

  const quitarFlotante = useCallback((id) => setFlotantes((l) => l.filter((f) => f.id !== id)), []);
  const confNivel = nivel ? NIVELES[nivel - 1] : null;

  const leerMarcha = (m, motivo = null) => {
    const nv = nivelRef.current ? NIVELES[nivelRef.current - 1] : null;
    setMarcha({ avance: nv ? avance(m, nv.meta) : 0, quedan: nv ? Math.max(0, nv.limite - m.soltadas) : 0, motivo });
  };

  // ── Lo que pasa cuando el mundo avisa: efectos, sonido, vibración, marcador ─
  const js = useRef({});
  js.current.eventos = (evs, m) => {
    setPuntos(m.puntos); setLimpiados(m.limpiados);
    const ahora = Date.now();
    const g = geo;
    const nuevos = [];
    const flota = (e, texto, clase, dy = 0) => { if (g) nuevos.push({ id: idFlotante.current++, x: g.ox + e.x * g.k, y: g.oy + (e.y + dy) * g.k, texto, clase }); };
    for (const e of evs) {
      efectoDe(fx.current, e);
      if (e.tipo === 'golpe') { if (e.fuerza > 0.5) { sonar('toque-1', { volumen: 0.25 + e.fuerza * 0.3, tono: 0.7 }); tacto.roce(); } continue; }
      if (e.tipo === 'limpia') {
        flota(e, `+${e.puntos}`, 'limpia');
        sonar('voltear', { volumen: 0.7, tono: 1.3 });
        continue;
      }
      if (e.tipo === 'gel') {
        sonar('ganar', { volumen: 0.6, tono: 1.2 }); tacto.exito();
        setAviso({ k: ahora, texto: e.limpiados ? `¡Limpieza! ${e.limpiados} ${e.limpiados === 1 ? 'germen menos' : 'gérmenes menos'}` : 'El gel no alcanzó ningún germen' });
        continue;
      }
      if (e.tipo === 'germen' || e.tipo === 'contagio') {
        if (ahora - ultimoAvisoMalo.current > 2500) {
          ultimoAvisoMalo.current = ahora;
          sonar('fallo', { volumen: 0.45, tono: 0.8 }); tacto.aviso();
          setAviso({ k: ahora, texto: e.tipo === 'contagio' ? '¡Contagio! Apareció otro germen' : e.solo ? '¡Un germen creció!' : '¡Los gérmenes se juntaron!' });
        }
        continue;
      }
      // Una unión de medicamentos (o la cumbre).
      const cumbre = e.tipo === 'cumbre';
      flota(e, `+${e.puntos}`, cumbre || e.n >= 7 ? 'grande' : 'normal', -10);
      if (e.racha > 1) flota(e, `×${e.mult}`, 'racha', 22);
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
          setAviso({ k: ahora, texto: `¡${ARTICULO[e.n] === 'el' ? 'Tu primer' : ARTICULO[e.n] === 'los' ? 'Tus primeros' : 'Tu primera'} ${NOMBRES[e.n]}!` });
          if (e.n >= 8) setFestejo((k) => k + 1);
          continue;
        }
      }
      if (e.racha >= 3) setAviso({ k: ahora + 1, texto: `¡Cadena ×${e.racha}!` });
    }
    if (nuevos.length) setFlotantes((l) => [...l.slice(-10), ...nuevos]);
    if (nivelRef.current) leerMarcha(m);
  };
  js.current.peligro = (si) => {
    if (si) { sonar('fallo', { volumen: 0.5 }); tacto.aviso(); setAviso({ k: Date.now(), texto: '¡Cuidado, se desborda!' }); } else setAviso(null);
  };
  const parar = () => { enJuegoRef.current = false; enJuego.value = false; setAviso(null); };
  js.current.perder = (m, motivo) => {
    parar();
    setPuntos(m.puntos); setLimpiados(m.limpiados); setFase('fin');
    sonar('derrumbe'); tacto.aviso();
    if (m.mayor > mayorHistRef.current) { mayorHistRef.current = m.mayor; setMayorHistorico(m.mayor); SecureStore.setItemAsync(CLAVE_MAYOR, String(m.mayor)).catch(() => {}); }
    if (nivelRef.current) { leerMarcha(m, motivo); return; }
    if (m.puntos > recordRef.current) {
      recordRef.current = m.puntos; setRecord(m.puntos); setNuevoRecord(true);
      SecureStore.setItemAsync(CLAVE_RECORD, String(m.puntos)).catch(() => {});
      setTimeout(() => { sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1); }, 700);
    }
  };
  js.current.ganar = (m) => {
    parar();
    const n = nivelRef.current; const k = estrellasDe(n, m.soltadas);
    setPuntos(m.puntos); setFase('gano');
    if (m.mayor > mayorHistRef.current) { mayorHistRef.current = m.mayor; setMayorHistorico(m.mayor); SecureStore.setItemAsync(CLAVE_MAYOR, String(m.mayor)).catch(() => {}); }
    setResultado({ estrellas: k, soltadas: m.soltadas, ...progreso.registrar(n, k) });
    setTimeout(() => { sonar('ganar'); tacto.exito(); setFestejo((x) => x + 1); }, 250);
  };

  const mostrar = (cuelga) => {
    const m = mundo.current;
    if (!m) return;
    const ef = fotoEfectos(fx.current);
    const nv = nivelRef.current ? NIVELES[nivelRef.current - 1] : null;
    foto.value = {
      t: m.t, peligro: m.peligro, actual: imagenDe(m.actual), c: fotoPiezas(m, fx.current, animarRef.current), ...ef,
      cuelga: cuelga && !m.perdio, lista: puedeSoltar(m) && (!nv || m.soltadas < nv.limite),
    };
  };

  // ── El reloj: requestAnimationFrame; el motor da pasos fijos de 1/120 s ─────
  const cuadroJs = useRef(null);
  cuadroJs.current = (dt) => {
    const m = mundo.current;
    if (!m || m.perdio) return;
    avanzar(m, dt);
    const d = Math.min(dt, 0.05);
    ambiente(fx.current, m, d);
    avanzarEfectos(fx.current, d);
    if (m.eventos.length) { const evs = m.eventos; m.eventos = []; js.current.eventos(evs, m); }
    if (!m.alerta && m.peligro > AVISO_PELIGRO) { m.alerta = true; js.current.peligro(true); } else if (m.alerta && m.peligro === 0) { m.alerta = false; js.current.peligro(false); }
    mostrar(true);
    const nv = nivelRef.current ? NIVELES[nivelRef.current - 1] : null;
    if (nv && avance(m, nv.meta) >= 1) { mostrar(false); js.current.ganar(m); return; }
    if (m.perdio) { mostrar(false); js.current.perder(m, 'desborde'); return; }
    // Sin piezas: se espera a que la última se asiente (puede cumplir la meta).
    if (nv && m.soltadas >= nv.limite && m.t - m.ultimaSoltada > 3) { mostrar(false); js.current.perder(m, 'piezas'); }
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

  const empezar = useCallback((n = nivelRef.current) => {
    destruir(mundo.current);
    nivelRef.current = n; setNivel(n);
    const m = crearMundo((Date.now() % 2147483000) + 1, n ? confDeNivel(n) : CONF_LIBRE);
    m.alerta = false;
    mundo.current = m;
    fx.current = crearEfectos({ quieto: !animarRef.current, oscuro: fx.current.oscuro });
    setPuntos(0); setMayor(0); mayorRef.current = 0; setLimpiados(0); setNuevoRecord(false); setPausa(false); setFlotantes([]); setResultado(null);
    leerMarcha(m);
    setAviso({ k: Date.now(), texto: n ? `${textoMeta(NIVELES[n - 1].meta)} · ${NIVELES[n - 1].limite} piezas` : '¡A jugar!' });
    apunta.value = CAJA.ANCHO / 2;
    mostrar(true);
    setCola({ actual: m.actual, siguiente: m.siguiente });
    setFase('jugando');
  }, [apunta, foto]); // eslint-disable-line react-hooks/exhaustive-deps
  const aPortada = useCallback(() => { destruir(mundo.current); mundo.current = null; setFase('portada'); setPausa(false); }, []);

  js.current.soltarEn = (x) => {
    const m = mundo.current;
    if (!enJuegoRef.current || !m) return;
    const nv = nivelRef.current ? NIVELES[nivelRef.current - 1] : null;
    if (nv && m.soltadas >= nv.limite) return;
    const pieza = m.actual;
    const b = soltar(m, x);
    if (!b) return;
    b.plugin.lanzada = true;
    lanzamiento(fx.current, b.position.x, b.position.y, imagenDe(pieza));
    setCola({ actual: m.actual, siguiente: m.siguiente });
    if (pieza.tipo === 'gel') sonar('gota', { volumen: 0.5, tono: 1.5 });
    else if (pieza.tipo === 'germen') sonar('gota', { volumen: 0.4, tono: 0.7 });
    else sonar('gota', { volumen: 0.45, tono: 1.3 - pieza.n * 0.07 });
    tacto.roce();
    if (nv) {
      leerMarcha(m);
      const q = nv.limite - m.soltadas;
      if (q === 10) setAviso({ k: Date.now(), texto: 'Quedan 10 piezas' });
      else if (q === 0) setAviso({ k: Date.now(), texto: '¡Última pieza!' });
    }
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

  // ── El estuche: se pinta UNA vez por tamaño y tema ──────────────────────────
  // Una sombra difusa por cuadro es de lo más caro que hay en un teléfono.
  const fondo = useDerivedValue(() => {
    const g = geoV.value; const im = arteV.value; const os = nocheV.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.w : 1, g ? g.h : 1));
    if (!g) return rec.finishRecordingAsPicture();
    const k = g.k; const W = CAJA.ANCHO; const H = CAJA.ALTO;
    const R = (x, y, w, h, r) => Skia.RRectXY(Skia.XYWHRect(g.ox + x * k, g.oy + y * k, w * k, h * k), r * k, r * k);
    const lin = (cols, pos) => Skia.Shader.MakeLinearGradient(Skia.Point(0, g.oy - 46 * k), Skia.Point(0, g.oy + H * k), cols.map((x) => Skia.Color(x)), pos, TileMode.Clamp);
    const sombra = Skia.Paint(); sombra.setAntiAlias(true); sombra.setColor(Skia.Color('#00140F')); sombra.setAlphaf(os ? 0.5 : 0.28);
    sombra.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 12 * k, true));
    c.drawRRect(R(-14, -34, W + 28, H + 58, 30), sombra);
    const marco = Skia.Paint(); marco.setAntiAlias(true);
    marco.setShader(os ? lin(['#A8DC2C', '#2BB3A8', '#B23CB1'], [0, 0.5, 1]) : lin(['#FFFFFF', '#E3ECEA'], null));
    c.drawRRect(R(-14, -46, W + 28, H + 60, 30), marco);
    if (os) { const borde = Skia.Paint(); borde.setAntiAlias(true); borde.setColor(Skia.Color('#0E3D42')); c.drawRRect(R(-12, -44, W + 24, H + 56, 28), borde); }
    const dentro = Skia.Paint(); dentro.setAntiAlias(true);
    dentro.setShader(lin(os ? ['#12494F', '#072327'] : ['#F7FCFA', '#CFE9DF'], null));
    c.drawRRect(R(0, -36, W, H + 36, 22), dentro);
    if (im) {
      const marca = Skia.Paint(); marca.setAlphaf(os ? 0.09 : 0.08);
      c.drawImageRect(im.logo, im.srcLogo, Skia.XYWHRect(g.ox + (W / 2 - 110) * k, g.oy + (H * 0.42 - 110) * k, 220 * k, 220 * k), marca);
    }
    return rec.finishRecordingAsPicture();
  });
  // El brillo del vidrio, encima de las piezas.
  const vidrio = useDerivedValue(() => {
    const g = geoV.value; const os = nocheV.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.w : 1, g ? g.h : 1));
    if (!g) return rec.finishRecordingAsPicture();
    const k = g.k;
    const p = Skia.Paint(); p.setAntiAlias(true); p.setAlphaf(os ? 0.3 : 0.7);
    p.setShader(Skia.Shader.MakeLinearGradient(Skia.Point(0, g.oy - 28 * k), Skia.Point(0, g.oy + CAJA.ALTO * k),
      [new Float32Array([1, 1, 1, 0.55]), new Float32Array([1, 1, 1, 0])], null, TileMode.Clamp));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(g.ox + 9 * k, g.oy - 28 * k, 9 * k, (CAJA.ALTO + 10) * k), 4.5 * k, 4.5 * k), p);
    return rec.finishRecordingAsPicture();
  });

  // ── El cuadro: un solo Picture con todo lo que se mueve ─────────────────────
  const cuadro = useDerivedValue(() => {
    const g = geoV.value; const im = arteV.value; const f = foto.value; const os = nocheV.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.w : 1, g ? g.h : 1));
    if (!g || !im) return rec.finishRecordingAsPicture();
    const k = g.k; const mov = animar.value; const W = CAJA.ANCHO; const H = CAJA.ALTO;
    const X = (x) => g.ox + x * k; const Y = (y) => g.oy + y * k;
    const CS = COLORES.map((x) => Skia.Color(x));
    const p = Skia.Paint(); p.setAntiAlias(true);
    const tinta = Skia.Paint(); tinta.setAntiAlias(true);
    const color = (i, a) => { tinta.setColor(CS[i]); tinta.setAlphaf(Math.max(0, Math.min(1, a))); return tinta; };
    // Un halo: degradado radial del color a transparente. En noche suma luz.
    const halo = (x, y, r, i, a) => {
      if (a <= 0.01 || r <= 0) return;
      const c0 = CS[i];
      const q = Skia.Paint(); q.setAntiAlias(true);
      q.setShader(Skia.Shader.MakeRadialGradient(Skia.Point(x, y), r,
        [c0, new Float32Array([c0[0], c0[1], c0[2], 0.35]), new Float32Array([c0[0], c0[1], c0[2], 0])], [0, 0.4, 1], TileMode.Clamp));
      q.setAlphaf(Math.min(1, a));
      if (os) q.setBlendMode(BlendMode.Plus);
      c.drawCircle(x, y, r, q);
    };
    const figura = (sombra, i, x, y, ang, e, sx, sy, alfa) => {
      const w = ANCHOS[i] * e * k; const h = ALTOS[i] * e * k;
      c.save(); c.translate(X(x), Y(y) + (sombra ? 3.5 * k : 0));
      if (sx !== 1 || sy !== 1) c.scale(sx, sy);
      if (ang) c.rotate((ang * 180) / Math.PI, 0, 0);
      const pp = alfa < 1 ? Skia.Paint() : p;
      if (alfa < 1) pp.setAlphaf(Math.max(0, alfa));
      if (sombra) {
        const M = MARGEN_SOMBRA * e * k;
        c.drawImageRect(im.sombras[i], im.srcS[i], Skia.XYWHRect(-w / 2 - M, -h / 2 - M, w + M * 2, h + M * 2), pp);
      } else c.drawImageRect(im.piezas[i], im.src[i], Skia.XYWHRect(-w / 2, -h / 2, w, h), pp);
      c.restore();
    };

    if (f && (f.dx || f.dy)) { c.save(); c.translate(f.dx * k, f.dy * k); }
    c.drawPicture(fondo.value);

    // El marco se enciende con las cadenas, el gel y los gérmenes.
    if (f && f.marco > 0) {
      const aro = Skia.Paint(); aro.setAntiAlias(true); aro.setStyle(PaintStyle.Stroke); aro.setColor(CS[f.marcoCol]);
      const rr = Skia.RRectXY(Skia.XYWHRect(X(-11), Y(-43), (W + 22) * k, (H + 54) * k), 28 * k, 28 * k);
      aro.setAlphaf(f.marco * 0.3); aro.setStrokeWidth(14 * k); c.drawRRect(rr, aro);
      aro.setAlphaf(f.marco); aro.setStrokeWidth(4 * k); c.drawRRect(rr, aro);
    }

    // El borde de arriba: punteado; rojo que late mientras algo se asoma, con un velo.
    const peligro = f ? f.peligro : 0;
    if (peligro > 0) {
      c.save();
      c.clipRRect(Skia.RRectXY(Skia.XYWHRect(X(0), Y(-36), W * k, (H + 36) * k), 22 * k, 22 * k), ClipOp.Intersect, true);
      const velo = Skia.Paint();
      velo.setShader(Skia.Shader.MakeLinearGradient(Skia.Point(0, Y(-36)), Skia.Point(0, Y(60)),
        [new Float32Array([0.88, 0.25, 0.17, Math.min(0.45, peligro * 0.25)]), new Float32Array([0.88, 0.25, 0.17, 0])], null, TileMode.Clamp));
      c.drawRect(Skia.XYWHRect(X(0), Y(-36), W * k, 96 * k), velo);
      c.restore();
    }
    const linea = peligro > 0 ? color(I_ROJO, mov ? 0.6 + 0.4 * Math.sin(f.t * 14) : 1) : os ? color(0, 0.4) : color(15, 0.45);
    const seg = 8 * k;
    for (let x = 0; x < W * k; x += seg * 2) c.drawRect(Skia.XYWHRect(g.ox + x, g.oy - 1, Math.min(seg, W * k - x), 2), linea);

    if (f) {
      const reloj = f.t;
      // La pieza que cuelga: guía hasta el fondo, halo y chispitas que la orbitan.
      if (enJuego.value && f.cuelga && f.lista) {
        const i = f.actual; const mitad = ANCHOS[i] / 2;
        const x = Math.min(W - mitad, Math.max(mitad, apunta.value));
        const guia = Skia.Paint(); guia.setColor(Skia.Color(os ? '#FFFFFF' : '#0E3B36')); guia.setAlphaf(0.25);
        const top = Y(Y_SOLTAR + ALTOS[i] / 2 + 6); const fin = Y(H);
        for (let y = top; y < fin; y += 10 * k) c.drawRect(Skia.XYWHRect(X(x) - 1, y, 2, Math.min(2.5 * k, fin - y)), guia);
        const yy = Y_SOLTAR + (mov ? Math.sin(reloj * 3) * 2 : 0); const R = Math.max(ANCHOS[i], ALTOS[i]);
        halo(X(x), Y(yy), R * 0.95 * k, 0, 0.55);
        if (mov) for (let o = 0; o < 3; o++) {
          const a = reloj * 2.6 + o * 2.094;
          c.drawCircle(X(x + Math.cos(a) * R * 0.62), Y(yy + Math.sin(a) * R * 0.3), 2.2 * k, color(ORBITA[i] + (o % 2), 0.85));
        }
        figura(true, i, x, yy, 0, 1, 1, 1, 1); figura(false, i, x, yy, 0, 1, 1, 1, 1);
      }
      const cs = f.c;
      // Halo tóxico debajo de cada germen.
      for (let j = 0; j < cs.length; j += 8) {
        const i = cs[j]; if (i < IMG_GERMEN || i >= IMG_GEL) continue;
        const n = i - IMG_GERMEN;
        halo(X(cs[j + 1]), Y(cs[j + 2]), RADIO_GERMEN[n] * 2.4 * k, ESTILO_GERMEN[n], 0.3 + (mov ? 0.1 * Math.sin(reloj * 4 + j) : 0));
      }
      for (let j = 0; j < cs.length; j += 8) figura(true, cs[j], cs[j + 1], cs[j + 2], cs[j + 3], cs[j + 4], cs[j + 5], cs[j + 6], 1);
      for (let j = 0; j < cs.length; j += 8) {
        // El germen a punto de crecer o contagiar late en rojo.
        if (cs[j + 7] > 0) halo(X(cs[j + 1]), Y(cs[j + 2]), RADIO_GERMEN[cs[j] - IMG_GERMEN] * (1.9 + (mov ? 0.3 * Math.sin(reloj * 16) : 0)) * k, I_ROJO_VIVO, 0.75 * cs[j + 7]);
        figura(false, cs[j], cs[j + 1], cs[j + 2], cs[j + 3], cs[j + 4], cs[j + 5], cs[j + 6], 1);
      }
      // Las dos que se funden en la nueva.
      const fs = f.f;
      for (let j = 0; j < fs.length; j += 6) figura(false, fs[j], fs[j + 1], fs[j + 2], fs[j + 3], fs[j + 4], 1, 1, fs[j + 5]);

      if (mov) {
        // Destellos y rayos.
        const ds = f.d;
        for (let j = 0; j < ds.length; j += 5) halo(X(ds[j]), Y(ds[j + 1]), ds[j + 2] * k, ds[j + 3], ds[j + 4]);
        const ys = f.y;
        for (let j = 0; j < ys.length; j += 7) {
          const L = ys[j + 2] * k; const n = ys[j + 6]; const ancho = (180 / n) * 0.45;
          const rayos = Skia.Path.Make();
          for (let q = 0; q < n; q++) { const a = (q / n) * 360; rayos.moveTo(0, 0); rayos.arcToOval(Skia.XYWHRect(-L, -L, L * 2, L * 2), a - ancho, ancho * 2, false); rayos.close(); }
          const rp = color(ys[j + 3], ys[j + 4]); if (os) rp.setBlendMode(BlendMode.Plus);
          c.save(); c.translate(X(ys[j]), Y(ys[j + 1])); c.rotate((ys[j + 5] * 180) / Math.PI, 0, 0); c.drawPath(rayos, rp); c.restore();
          rp.setBlendMode(BlendMode.SrcOver);
        }
        // Ondas.
        const aro = Skia.Paint(); aro.setAntiAlias(true); aro.setStyle(PaintStyle.Stroke);
        const os2 = f.o;
        for (let j = 0; j < os2.length; j += 6) {
          aro.setColor(CS[os2[j + 3]]); aro.setAlphaf(os2[j + 4]); aro.setStrokeWidth(os2[j + 5] * k);
          c.drawCircle(X(os2[j]), Y(os2[j + 1]), os2[j + 2] * k, aro);
        }
      }
      // Partículas. Las formas con giro comparten dos trazos hechos una vez por cuadro.
      const ps = f.p;
      if (ps.length) {
        const estrella = Skia.Path.Make();
        for (let q = 0; q < 8; q++) { const a = (q * Math.PI) / 4; const r = q % 2 ? 0.28 : 1; if (q) estrella.lineTo(Math.cos(a) * r, Math.sin(a) * r); else estrella.moveTo(r, 0); }
        estrella.close();
        const brillo = Skia.Path.Make();
        brillo.moveTo(0, -2.4); brillo.quadTo(0, 0, 2.4, 0); brillo.quadTo(0, 0, 0, 2.4); brillo.quadTo(0, 0, -2.4, 0); brillo.quadTo(0, 0, 0, -2.4); brillo.close();
        const trazo = Skia.Paint(); trazo.setAntiAlias(true); trazo.setStyle(PaintStyle.Stroke); trazo.setStrokeCap(StrokeCap.Round);
        for (let j = 0; j < ps.length; j += 8) {
          const r = ps[j + 2] * k; if (r <= 0.05) continue;
          const x = X(ps[j]); const y = Y(ps[j + 1]); const fm = ps[j + 3]; const a = ps[j + 5]; const rot = ps[j + 6];
          if (fm === F_PUNTO || fm === F_HUMO) { c.drawCircle(x, y, r, color(ps[j + 4], a)); continue; }
          if (fm === F_BABA) { const t = color(ps[j + 4], a); c.drawCircle(x, y, r, t); c.drawCircle(x + Math.cos(rot) * r * 1.1, y + Math.sin(rot) * r * 1.1, r * 0.45, t); continue; }
          if (fm === F_BURBUJA || fm === F_ESPORA) {
            trazo.setColor(CS[ps[j + 4]]); trazo.setAlphaf(a * (fm === F_ESPORA ? 0.8 : 1)); trazo.setStrokeWidth(1.1);
            c.drawCircle(x, y, fm === F_BURBUJA ? r * 1.2 : r, trazo);
            c.drawCircle(x, y, fm === F_BURBUJA ? r * 1.2 : r * 0.4, color(ps[j + 4], a * (fm === F_BURBUJA ? 0.25 : 0.8)));
            continue;
          }
          if (fm === F_CHISPA) {
            const L = ps[j + 7] * k; const cx = Math.cos(rot); const sy = Math.sin(rot);
            trazo.setColor(CS[ps[j + 4]]); trazo.setAlphaf(a); trazo.setStrokeWidth(r * 0.6);
            c.drawLine(x - cx * L, y - sy * L, x + cx * L * 0.4, y + sy * L * 0.4, trazo);
            continue;
          }
          c.save(); c.translate(x, y); c.rotate((rot * 180) / Math.PI, 0, 0);
          const t = color(ps[j + 4], a);
          if (fm === F_GOTA) { const L = ps[j + 7] * k; c.drawOval(Skia.XYWHRect(-L, -r * 0.85, L * 2, r * 1.7), t); }
          else if (fm === F_CUADRO) c.drawRect(Skia.XYWHRect(-r, -r * 0.6, r * 2, r * 1.2), t);
          else if (fm === F_CRUZ) { c.drawRect(Skia.XYWHRect(-r * 0.35, -r, r * 0.7, r * 2), t); c.drawRect(Skia.XYWHRect(-r, -r * 0.35, r * 2, r * 0.7), t); }
          else { c.scale(r, r); c.drawPath(fm === F_DESTELLO ? brillo : estrella, t); }
          c.restore();
        }
      }
    }
    c.drawPicture(vidrio.value);
    // Latido rojo arriba mientras algo se asoma.
    if (peligro > 0) halo(X(W / 2), Y(-30), W * 0.75 * k, I_ROJO, Math.min(0.55, peligro * 0.35) * (mov ? 0.7 + 0.3 * Math.sin(f.t * 10) : 1));
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
  const ultimo = nivel === NIVELES.length;

  return (
    <Escena colores={noche ? ESCENAS.botiquin : ESCENA_CLARA} fijo estilo={{ gap: 8 }}>
      <ControlesSensaciones izquierda={<>
        {fase === 'portada' || !nivel
          ? <Marcador sf="trophy.fill" texto={entero(record)} etiqueta={`Récord: ${entero(record)} puntos`} />
          : <Marcador sf="star.fill" texto={`${progreso.total}`} etiqueta={`${progreso.total} estrellas`} />}
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

      {fase !== 'portada' && confNivel ? (
        <View style={estilos.meta} accessible accessibilityLabel={`Nivel ${nivel}: ${textoMeta(confNivel.meta)}. ${Math.round(marcha.avance * 100)} por ciento. Quedan ${marcha.quedan} piezas.`}>
          <PiezaImg i={iconoMeta(confNivel.meta)} tam={24} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={estilos.metaTexto}>{textoMeta(confNivel.meta)}</Text>
            <View style={estilos.barra}><View style={[estilos.barraLlena, { width: `${Math.round(marcha.avance * 100)}%` }]} /></View>
          </View>
          <Text maxFontSizeMultiplier={1.2} style={[estilos.quedan, marcha.quedan <= 10 && { color: '#FFB3A3' }]}>{marcha.quedan}{'\n'}<Text style={estilos.quedanRotulo}>piezas</Text></Text>
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
          <ScrollView style={StyleSheet.absoluteFill} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 16 }}>
            <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <PiezaImg i={2} tam={56} /><PiezaImg i={MAX} tam={92} /><PiezaImg i={7} tam={66} />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={estilos.titulo}>Botiquín</Text>
              <Text style={{ ...textoAyuda, textAlign: 'center' }}>
                Arrastra y suelta. Dos medicamentos iguales que se tocan se juntan en el siguiente: ¡llega al sello Farmasalud!
              </Text>
            </Animated.View>
            <BotonJuego sf="play.fill" alTocar={() => empezar(null)}>{record ? `Juego libre · récord ${entero(record)}` : 'Juego libre'}</BotonJuego>
            <SelectorNiveles total={NIVELES.length} progreso={progreso} alElegir={(n) => empezar(n)}
              detalle={(n) => `${metaCorta(NIVELES[n - 1].meta)} · ${NIVELES[n - 1].limite}`} />
            <PanelVidrio estilo={{ gap: 12 }}>
              <Cadena mayor={mayorHistorico} />
              <View style={estilos.fila}>
                <PiezaImg i={IMG_GERMEN} tam={30} />
                <Text style={[textoAyuda, { flex: 1 }]}>Los gérmenes crecen y contagian. Elimínalos con una unión que los toque…</Text>
              </View>
              <View style={estilos.fila}>
                <PiezaImg i={IMG_GEL} tam={30} />
                <Text style={[textoAyuda, { flex: 1 }]}>…o tírales gel: estalla y limpia los de alrededor.</Text>
              </View>
              <Text style={textoAyuda}>Cada nivel tiene una meta y piezas contadas: si se acaban, se pierde. Con menos piezas, más estrellas.</Text>
            </PanelVidrio>
          </ScrollView>
        ) : null}

        {jugando && pausa ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={estilos.encima}>
            <TarjetaNivel titulo="En pausa" texto={`Llevas ${entero(puntos)} puntos.`}>
              <BotonJuego sf="play.fill" alTocar={() => setPausa(false)}>Seguir</BotonJuego>
              <BotonJuego secundario sf="arrow.clockwise" alTocar={() => empezar()}>Empezar de nuevo</BotonJuego>
              <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={aPortada}>Salir</BotonJuego>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {fase === 'fin' ? (
          <Animated.View entering={FadeIn.delay(600).duration(400)} style={estilos.encima}>
            {nivel ? (
              <TarjetaNivel titulo={marcha.motivo === 'piezas' ? 'Se acabaron las piezas' : 'Se desbordó'}
                texto={`${textoMeta(confNivel.meta)}: llegaste al ${Math.round(marcha.avance * 100)}%. ¡Inténtalo otra vez!`}>
                <BotonJuego sf="arrow.clockwise" alTocar={() => empezar()}>Otra vez</BotonJuego>
                <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={aPortada}>Niveles</BotonJuego>
              </TarjetaNivel>
            ) : (
              <TarjetaNivel insignia={nuevoRecord ? '¡NUEVO RÉCORD!' : null} titulo={`${entero(puntos)} puntos`}
                texto={`${nuevoRecord ? 'Tu mejor partida hasta ahora.' : `Tu récord es de ${entero(record)}.`} Lo más grande: ${NOMBRES[mayor]}. Gérmenes eliminados: ${entero(limpiados)}.`}>
                <Cadena mayor={mayor} tam={26} />
                <BotonJuego sf="arrow.clockwise" alTocar={() => empezar()}>Jugar otra vez</BotonJuego>
                <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={aPortada}>Menú</BotonJuego>
              </TarjetaNivel>
            )}
          </Animated.View>
        ) : null}

        {fase === 'gano' && resultado ? (
          <Animated.View entering={FadeIn.delay(500).duration(400)} style={estilos.encima}>
            <TarjetaNivel estrellas={resultado.estrellas}
              insignia={resultado.mejoro && !resultado.primera ? '¡MÁS ESTRELLAS!' : null}
              titulo={ultimo ? '¡Terminaste todos los niveles!' : `¡Nivel ${nivel} superado!`}
              texto={`Con ${resultado.soltadas} piezas.${resultado.estrellas < 3 ? ` Para tres estrellas: ${confNivel.tope[1]} o menos.` : ' ¡Perfecto!'}`}>
              {!ultimo ? <BotonJuego sf="play.fill" alTocar={() => empezar(nivel + 1)}>Siguiente nivel</BotonJuego> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonJuego secundario sf="arrow.clockwise" alTocar={() => empezar()}>Repetir</BotonJuego></View>
                <View style={{ flex: 1 }}><BotonJuego secundario sf="square.grid.2x2.fill" alTocar={aPortada}>Niveles</BotonJuego></View>
              </View>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', ORO, '#8DC311', '#9A1D96', '#FF6FAE']} alTerminar={() => {}} /> : null}
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
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  metaTexto: { fontSize: 14, fontWeight: '800', color: BLANCO },
  barra: { height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.22)', overflow: 'hidden' },
  barraLlena: { height: 6, borderRadius: 3, backgroundColor: ORO },
  quedan: { fontSize: 18, fontWeight: '900', color: BLANCO, textAlign: 'center', fontVariant: ['tabular-nums'], lineHeight: 19 },
  quedanRotulo: { fontSize: 10, fontWeight: '700', color: BLANCO_2 },
  cadena: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.2)', alignSelf: 'center' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flotante: { fontSize: 19, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  titulo: { fontSize: 30, fontWeight: '900', color: BLANCO, textAlign: 'center' },
  encima: { position: 'absolute', left: 0, right: 0, bottom: 8 },
});
