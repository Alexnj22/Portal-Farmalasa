// Torre (Bienestar, 2026-11-03; reemplaza al jardín zen: «el zen no me gusta,
// pon otro juego entretenido… que sea muy visual, moderno, entretenido»).
//
// Un bloque va y viene sobre la torre y se toca para soltarlo: lo que sobresale
// se corta y cae girando. Si cae justo encima es un PERFECTO —destello, una
// nota que sube con la racha— y desde el tercero seguido el bloque recupera un
// poco de ancho. Cada piso va un poco más rápido y el cielo se oscurece hacia
// las estrellas. Cada 10 pisos, confeti. Al perder, la cámara se aleja para
// mostrar la torre entera; el récord queda en el teléfono.
//
// El bloque que se mueve vive en el hilo de la interfaz (Reanimated) y el toque
// se lee ahí mismo: la posición con la que se corta es la que se ve, no la de
// un cuadro después. React sólo se entera al soltar, una vez por piso.
//
// Niveles (2026-11-04, «aplica los niveles a los juegos que ya están»): doce
// torres con una meta de pisos. Cada nivel arranca más rápido y con el bloque
// más angosto; desde el 3 aparecen pisos DORADOS (un perfecto ahí cuenta doble
// y devuelve ancho) y desde el 5, ráfagas de VIENTO que hacen que el bloque
// acelere y frene. Las estrellas salen de los perfectos. «Infinito» es la
// torre de antes, con su récord.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Canvas, Group, LinearGradient, Path, Picture, Rect, RoundedRect, Skia, TileMode, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { Confeti } from '../componentes/animacion';
import { AvisoJuego, BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio, textoAyuda } from '../componentes/juegos/Escena';
import { ORO, SelectorNiveles, TarjetaNivel, useProgreso } from '../componentes/juegos/Niveles';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const CLAVE = 'puntos_salud_torre_record';
const SONIDOS = ['bloque', 'derrumbe', 'ganar', 'toque-1', 'toque-2', 'toque-3', 'toque-4', 'toque-5', 'toque-6'];
const TOLERANCIA = 6; // puntos de perdón para contar un perfecto (a 390 de ancho)
const RECUPERA = 12; // ancho que devuelve cada perfecto desde el tercero seguido
const CLAVE_NIVEL = 'puntos_salud_torre_nivel';
const CLAVE_ESTRELLAS = 'puntos_salud_torre_estrellas';
// Cada nivel: meta de pisos, velocidad de salida (fracción del ancho por
// segundo), ancho del primer bloque, cada cuántos pisos sale uno dorado (0:
// nunca) y la fuerza del viento (0: sin viento; 0.4 es que acelera y frena
// un 40%). El viento sopla en la mitad de los pisos, al azar.
const NIVELES = [
  { meta: 8, vel: 0.40, ancho: 0.58, oro: 0, viento: 0 },
  { meta: 10, vel: 0.44, ancho: 0.56, oro: 0, viento: 0 },
  { meta: 12, vel: 0.46, ancho: 0.56, oro: 5, viento: 0 },
  { meta: 12, vel: 0.50, ancho: 0.50, oro: 5, viento: 0 },
  { meta: 14, vel: 0.50, ancho: 0.52, oro: 0, viento: 0.3 },
  { meta: 15, vel: 0.54, ancho: 0.48, oro: 4, viento: 0 },
  { meta: 16, vel: 0.58, ancho: 0.50, oro: 5, viento: 0.3 },
  { meta: 18, vel: 0.60, ancho: 0.46, oro: 0, viento: 0.4 },
  { meta: 20, vel: 0.62, ancho: 0.46, oro: 4, viento: 0.35 },
  { meta: 22, vel: 0.66, ancho: 0.44, oro: 4, viento: 0.4 },
  { meta: 25, vel: 0.68, ancho: 0.42, oro: 5, viento: 0.5 },
  { meta: 30, vel: 0.72, ancho: 0.40, oro: 4, viento: 0.5 },
];
const INFINITO = { meta: 0, vel: 0.42, ancho: 0.56, oro: 0, viento: 0 };
const MODOS = [{ valor: 'niveles', texto: 'Niveles', detalle: `${NIVELES.length} torres` }, { valor: 'infinito', texto: 'Infinito', detalle: 'récord' }];
// Estrellas por perfectos (un dorado perfecto cuenta dos): la mitad de la meta da tres.
const estrellasDe = (perfectos, meta) => (perfectos >= Math.ceil(meta * 0.5) ? 3 : perfectos >= Math.ceil(meta * 0.25) ? 2 : 1);
const esOro = (conf, i) => conf.oro > 0 && i > 0 && i % conf.oro === 0;

// El color de cada piso: el tono gira despacio, así la torre es un arcoíris.
function hsl(h, s, l) {
  const S = s / 100; const L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const hx = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}
const tono = (i) => { const h = (195 + i * 12) % 360; return [hsl(h, 95, 74), hsl(h, 82, 58), hsl(h, 72, 40)]; };
const DORADO = ['#FFF3A6', '#FFC93C', '#C98A00'];
const colorDe = (b) => (b.oro ? DORADO : tono(b.i));

// La base y los pisos ya puestos, grabados en una sola imagen (en JavaScript,
// una vez por bloque soltado).
function dibujarTorre(bloques, g) {
  const rec = Skia.PictureRecorder();
  const tope = g.baseY - (bloques.length + 40) * g.H - g.A;
  const c = rec.beginRecording(Skia.XYWHRect(-g.W, tope, g.W * 3, g.baseY + g.H * 6 - tope));
  const p = Skia.Paint(); p.setAntiAlias(true);
  const cx = g.W / 2;
  p.setShader(Skia.Shader.MakeRadialGradient(Skia.Point(cx, g.baseY + g.H), g.W * 0.5,
    [Skia.Color('rgba(170,190,255,0.35)'), Skia.Color('rgba(170,190,255,0)')], null, TileMode.Clamp));
  c.drawCircle(cx, g.baseY + g.H, g.W * 0.5, p);
  p.setShader(Skia.Shader.MakeLinearGradient(Skia.Point(0, g.baseY), Skia.Point(0, g.baseY + g.H * 3),
    [Skia.Color('rgba(255,255,255,0.42)'), Skia.Color('rgba(255,255,255,0.06)')], null, TileMode.Clamp));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect((g.W - g.W0) / 2 - 18, g.baseY, g.W0 + 36, g.H * 4), 14, 14), p);
  const liso = Skia.Paint(); liso.setAntiAlias(true);
  liso.setColor(Skia.Color('rgba(255,255,255,0.7)'));
  c.drawRect(Skia.XYWHRect((g.W - g.W0) / 2 - 10, g.baseY + 2, g.W0 + 20, 2), liso);
  const sombra = Skia.Paint(); sombra.setAntiAlias(true); sombra.setColor(Skia.Color('rgba(0,0,20,0.28)'));
  const brillo = Skia.Paint(); brillo.setAntiAlias(true); brillo.setColor(Skia.Color('rgba(255,255,255,0.5)'));
  for (const b of bloques) {
    const y = g.baseY - (b.i + 1) * g.H;
    const [c1, c2, c3] = colorDe(b);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x + 1, y + 4, b.w, g.H), 7, 7), sombra);
    p.setShader(Skia.Shader.MakeLinearGradient(Skia.Point(0, y), Skia.Point(0, y + g.H),
      [Skia.Color(c1), Skia.Color(c2), Skia.Color(c3)], null, TileMode.Clamp));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x, y, b.w, g.H), 7, 7), p);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x + 5, y + 3, Math.max(0, b.w - 10), Math.max(2, g.H * 0.16)), 3, 3), brillo);
  }
  return rec.finishRecordingAsPicture();
}

const Bloque = memo(function Bloque({ x, y, w, h, i, oro }) {
  const [c1, c2, c3] = oro ? DORADO : tono(i);
  return (
    <Group>
      {/* Sombra corrida, no un filtro: con 24 pisos, 24 filtros de sombra
          rehechos en cada cuadro del bloque que se mueve trababan Android. */}
      <RoundedRect x={x + 1} y={y + 4} width={w} height={h} r={7} color="rgba(0,0,20,0.28)" />
      <RoundedRect x={x} y={y} width={w} height={h} r={7}>
        <LinearGradient start={vec(0, y)} end={vec(0, y + h)} colors={[c1, c2, c3]} />
      </RoundedRect>
      <RoundedRect x={x + 5} y={y + 3} width={Math.max(0, w - 10)} height={Math.max(2, h * 0.16)} r={3} color="rgba(255,255,255,0.5)" />
    </Group>
  );
});

// El bloque que va y viene: x y ancho son valores del hilo de la interfaz.
function Movil({ posX, ancho, y, h, i, oro, visible }) {
  const [c1, c2, c3] = oro ? DORADO : tono(i);
  const x2 = useDerivedValue(() => posX.value + 5);
  const w2 = useDerivedValue(() => Math.max(0, ancho.value - 10));
  const xHalo = useDerivedValue(() => posX.value - 6);
  const wHalo = useDerivedValue(() => ancho.value + 12);
  return (
    <Group opacity={visible}>
      {/* El halo es un rectángulo translúcido, no un desenfoque animado. */}
      <RoundedRect x={xHalo} y={y - 5} width={wHalo} height={h + 10} r={11} color={`${c1}38`} />
      <RoundedRect x={posX} y={y} width={ancho} height={h} r={7}>
        <LinearGradient start={vec(0, y)} end={vec(0, y + h)} colors={[c1, c2, c3]} />
      </RoundedRect>
      <RoundedRect x={x2} y={y + 3} width={w2} height={Math.max(2, h * 0.16)} r={3} color="rgba(255,255,255,0.55)" />
    </Group>
  );
}

// Lo que se cortó: cae girando y se apaga.
function Pieza({ p, caida }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(1, { duration: 1100, easing: Easing.in(Easing.quad) }); }, [t]);
  const transform = useDerivedValue(() => [{ translateY: t.value * caida }, { rotate: p.giro * t.value }]);
  const opacidad = useDerivedValue(() => 1 - t.value * t.value);
  return (
    <Group transform={transform} origin={vec(p.x + p.w / 2, p.y + p.h / 2)} opacity={opacidad}>
      <Bloque x={p.x} y={p.y} w={p.w} h={p.h} i={p.i} oro={p.oro} />
    </Group>
  );
}

// El destello de un perfecto: un marco de luz que se abre y se apaga.
function Destello({ x, y, w, h, oro }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }); }, [t]);
  const ix = useDerivedValue(() => x - t.value * 18);
  const iy = useDerivedValue(() => y - t.value * 12);
  const iw = useDerivedValue(() => w + t.value * 36);
  const ih = useDerivedValue(() => h + t.value * 24);
  const op = useDerivedValue(() => (1 - t.value) * 0.95);
  return (
    <RoundedRect x={ix} y={iy} width={iw} height={ih} r={12} style="stroke" strokeWidth={oro ? 4 : 3} color={oro ? '#FFE27A' : '#FFFFFF'} opacity={op} />
  );
}

function Cielo({ ancho, alto, camara, pisoAlto }) {
  // Estrellas que aparecen a medida que se sube, con un poco de paralaje.
  const estrellas = useMemo(() => {
    let s = 7; const azar = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    // Todas en UN trazo: 110 círculos sueltos eran 110 figuras por cuadro.
    const tenues = Skia.Path.Make(); const vivas = Skia.Path.Make();
    for (let k = 0; k < 110; k++) {
      const x = azar() * ancho; const y = alto - azar() * alto * 6; const r = 0.6 + azar() * 1.6;
      (azar() > 0.5 ? vivas : tenues).addCircle(x, y, r);
    }
    return { tenues, vivas };
  }, [ancho, alto]);
  const paralaje = useDerivedValue(() => [{ translateY: camara.value * 0.3 }]);
  const brillo = useDerivedValue(() => Math.min(1, 0.15 + camara.value / (pisoAlto * 18)));
  const noche = useDerivedValue(() => Math.min(0.72, camara.value / (pisoAlto * 40)));
  return (
    <Group>
      <Rect x={0} y={0} width={ancho} height={alto} color="#03041A" opacity={noche} />
      <Group transform={paralaje} opacity={brillo}>
        <Path path={estrellas.tenues} color="rgba(255,255,255,0.45)" />
        <Path path={estrellas.vivas} color="rgba(255,255,255,0.9)" />
      </Group>
    </Group>
  );
}


export default function Torre() {
  const progreso = useProgreso(CLAVE_NIVEL, CLAVE_ESTRELLAS);
  const [modo, setModo] = useState('niveles');
  const [numNivel, setNumNivel] = useState(1);
  const conf = modo === 'niveles' ? NIVELES[numNivel - 1] : INFINITO;
  const confRef = useRef(conf);
  confRef.current = conf;
  const [geo, setGeo] = useState(null);
  const geoRef = useRef(null);
  const [fase, setFase] = useState('elegir'); // elegir · listo · jugando · fin · gano
  const [torre, setTorre] = useState([]);
  const torreRef = useRef([]);
  const [piezas, setPiezas] = useState([]);
  const [destello, setDestello] = useState(null);
  const comboRef = useRef(0);
  const [perfectos, setPerfectos] = useState(0);
  const perfectosRef = useRef(0);
  const [aviso, setAviso] = useState(null);
  const [hayViento, setHayViento] = useState(false);
  const [record, setRecord] = useState(0);
  const recordRef = useRef(0);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [festejo, setFestejo] = useState(0);
  const idPieza = useRef(0);
  const relojes = useRef([]);
  const anchoInicial = useRef(0);

  const posX = useSharedValue(0);
  const ancho = useSharedValue(0);
  const dir = useSharedValue(1);
  const vel = useSharedValue(0);
  const minX = useSharedValue(0);
  const maxX = useSharedValue(0);
  const moviendo = useSharedValue(false);
  const visible = useSharedValue(1);
  const camara = useSharedValue(0);
  const zoom = useSharedValue(1);
  const viento = useSharedValue(0);
  const rafaga = useSharedValue(0);

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v) || 0; recordRef.current = n; setRecord(n); }).catch(() => {});
    return () => { moviendo.value = false; relojes.current.forEach(clearTimeout); callar(SONIDOS); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const luego = (fn, ms) => { relojes.current.push(setTimeout(fn, ms)); };

  useFrameCallback((f) => {
    if (!moviendo.value) return;
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    // El viento: la velocidad sube y baja como en ráfagas, sin cambiar de sentido.
    let v = vel.value;
    if (viento.value > 0) { rafaga.value += dt; v *= 1 + viento.value * Math.sin(rafaga.value * 2.6) * Math.sin(rafaga.value * 0.9 + 1); }
    let x = posX.value + dir.value * v * dt;
    if (x > maxX.value) { x = maxX.value; dir.value = -1; } else if (x < minX.value) { x = minX.value; dir.value = 1; }
    posX.value = x;
  });

  const lanzar = useCallback((n, w) => {
    const g = geoRef.current;
    const c = confRef.current;
    ancho.value = w;
    minX.value = -w * 0.3;
    maxX.value = g.W - w * 0.7;
    const desdeIzquierda = n % 2 === 1;
    posX.value = desdeIzquierda ? minX.value : maxX.value;
    dir.value = desdeIzquierda ? 1 : -1;
    vel.value = Math.min(g.W * 1.2, g.W * (c.vel + n * 0.018));
    const sopla = c.viento > 0 && n > 1 && Math.random() < 0.5;
    viento.value = sopla ? c.viento : 0;
    rafaga.value = Math.random() * 3;
    setHayViento(sopla);
    visible.value = 1;
    moviendo.value = true;
  }, [ancho, dir, maxX, minX, moviendo, posX, rafaga, vel, viento, visible]);

  const empezar = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    const w0 = Math.round(g.W * confRef.current.ancho);
    anchoInicial.current = w0;
    const inicial = [{ x: (g.W - w0) / 2, w: w0, i: 0 }];
    torreRef.current = inicial;
    setTorre(inicial);
    setPiezas([]);
    setDestello(null);
    setAviso(null);
    comboRef.current = 0;
    perfectosRef.current = 0; setPerfectos(0);
    setNuevoRecord(false);
    setResultado(null);
    zoom.value = withTiming(1, { duration: 450 });
    camara.value = withTiming(0, { duration: 450 });
    setFase('listo');
    lanzar(1, w0);
  }, [camara, lanzar, zoom]);

  // La cámara se aleja hasta que la torre entera entra en la pantalla.
  const alejar = useCallback((puntos) => {
    const g = geoRef.current;
    const cabe = Math.min(1, (g.A * 0.55) / ((puntos + 3) * g.H));
    luego(() => {
      camara.value = withTiming(0, { duration: 1300, easing: Easing.inOut(Easing.cubic) });
      zoom.value = withTiming(cabe, { duration: 1300, easing: Easing.inOut(Easing.cubic) });
    }, 450);
  }, [camara, zoom]);

  const terminar = useCallback((puntos) => {
    setFase('fin');
    visible.value = withTiming(0, { duration: 200 });
    sonar('derrumbe');
    tacto.aviso();
    luego(() => tacto.golpe(), 180);
    alejar(puntos);
    if (confRef.current.meta) return;
    if (puntos > recordRef.current) {
      recordRef.current = puntos; setRecord(puntos); setNuevoRecord(true);
      SecureStore.setItemAsync(CLAVE, String(puntos)).catch(() => {});
      luego(() => { sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1); }, 700);
    }
  }, [alejar, visible]);

  const ganar = useCallback((puntos) => {
    moviendo.value = false;
    visible.value = withTiming(0, { duration: 200 });
    viento.value = 0; setHayViento(false);
    setFase('gano');
    const k = estrellasDe(perfectosRef.current, confRef.current.meta);
    setResultado({ estrellas: k, ...progreso.registrar(numNivel, k) });
    luego(() => { sonar('ganar'); tacto.exito(); setFestejo((x) => x + 1); }, 250);
    alejar(puntos);
  }, [alejar, moviendo, numNivel, progreso, viento, visible]);

  const soltar = useCallback((x) => {
    const g = geoRef.current;
    const t = torreRef.current;
    const c = confRef.current;
    if (!g || !t.length) return;
    if (fase === 'listo') setFase('jugando');
    const previo = t[t.length - 1];
    const n = t.length;
    const w = ancho.value;
    const y = g.baseY - (n + 1) * g.H;
    const oro = esOro(c, n);
    let xx = x;
    const perfecto = Math.abs(xx - previo.x) <= TOLERANCIA * g.escala;
    if (perfecto) xx = previo.x;
    const izquierda = Math.max(xx, previo.x);
    const derecha = Math.min(xx + w, previo.x + previo.w);
    const solapa = derecha - izquierda;
    idPieza.current += 1;
    const id = idPieza.current;
    const quitar = () => setPiezas((p) => p.filter((q) => q.id !== id));

    if (solapa <= 1) {
      setPiezas((p) => [...p, { id, x: xx, y, w, h: g.H, i: n, oro, giro: xx < previo.x ? -1.4 : 1.4 }]);
      luego(quitar, 1200);
      terminar(n - 1);
      return;
    }

    const bloque = { x: izquierda, w: solapa, i: n, oro };
    const tope = anchoInicial.current || g.W0;
    if (perfecto) {
      const k = comboRef.current + 1;
      comboRef.current = k;
      perfectosRef.current += oro ? 2 : 1; setPerfectos(perfectosRef.current);
      // Un dorado perfecto devuelve el doble de ancho, desde el primero.
      const devuelve = oro ? RECUPERA * 2 : k >= 3 ? RECUPERA : 0;
      if (devuelve && bloque.w < tope) {
        const nuevo = Math.min(tope, bloque.w + devuelve * g.escala);
        bloque.x -= (nuevo - bloque.w) / 2; bloque.w = nuevo;
      }
      setDestello({ k: id, x: bloque.x, y, w: bloque.w, h: g.H, oro });
      setAviso({ k: id, texto: oro ? '¡Dorado perfecto! ×2' : k > 1 ? `¡Perfecto ×${k}!` : '¡Perfecto!' });
      sonar(`toque-${Math.min(6, k)}`);
      sonar(oro ? 'ganar' : 'bloque', { volumen: oro ? 0.5 : 0.45 });
      tacto.golpe();
    } else {
      comboRef.current = 0;
      setAviso(null);
      const corte = xx < previo.x ? { x: xx, w: previo.x - xx } : { x: derecha, w: xx + w - derecha };
      setPiezas((p) => [...p, { id, ...corte, y, h: g.H, i: n, oro, giro: xx < previo.x ? -1.1 : 1.1 }]);
      luego(quitar, 1200);
      sonar('bloque');
      tacto.toque();
    }

    const nueva = [...t, bloque];
    torreRef.current = nueva;
    setTorre(nueva);
    const puntos = nueva.length - 1;
    // La cámara sube para que la punta quede siempre a la misma altura.
    const meta = Math.max(0, (nueva.length - g.pisosVisibles) * g.H);
    camara.value = withTiming(meta, { duration: 380, easing: Easing.out(Easing.cubic) });
    if (c.meta && puntos >= c.meta) { ganar(puntos); return; }
    if (!c.meta && puntos % 10 === 0) { luego(() => { sonar('ganar', { volumen: 0.7 }); tacto.exito(); }, 120); setFestejo((k) => k + 1); }
    lanzar(n + 1, bloque.w);
  }, [ancho, camara, fase, ganar, lanzar, terminar]);

  const alTocar = useRef(null);
  alTocar.current = (x) => { if (x != null) soltar(x); };
  const tocar = useCallback((x) => alTocar.current?.(x), []);
  const gesto = useMemo(() => Gesture.Tap().maxDuration(60000).onBegin(() => {
    'worklet';
    if (!moviendo.value) return;
    moviendo.value = false;
    runOnJS(tocar)(posX.value);
  }), [moviendo, posX, tocar]);

  const medir = useCallback((e) => {
    const { width: W, height: A } = e.nativeEvent.layout;
    if (!W || !A || (geoRef.current && geoRef.current.W === W && geoRef.current.A === A)) return;
    const H = Math.round(Math.max(22, Math.min(34, A / 17)));
    const g = { W, A, H, W0: Math.round(W * 0.56), baseY: A - H * 2.4, escala: W / 390, pisosVisibles: Math.floor((A * 0.5) / H) };
    geoRef.current = g;
    setGeo(g);
  }, []);
  useEffect(() => { if (geo && fase !== 'elegir') empezar(); }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  const jugarNivel = (n) => { setNumNivel(n); confRef.current = NIVELES[n - 1]; empezar(); };
  const aNiveles = () => { moviendo.value = false; relojes.current.forEach(clearTimeout); relojes.current = []; setHayViento(false); setFase('elegir'); };
  const cambiarModo = (m) => {
    setModo(m);
    if (m === 'infinito') { confRef.current = INFINITO; setFase('listo'); empezar(); } else aNiveles();
  };

  const camaraT = useDerivedValue(() => [{ translateY: camara.value }]);
  const zoomT = useDerivedValue(() => [{ scale: zoom.value }]);

  const puntos = Math.max(0, torre.length - 1);
  const n = torre.length;
  const acabado = fase === 'fin' || fase === 'gano';
  // Mientras se juega sólo se pintan los últimos pisos; al final, la torre entera.
  const visibles = acabado ? torre.slice(-160) : torre.slice(-24);
  const torrePic = useMemo(() => (geo ? dibujarTorre(visibles, geo) : null), [geo, torre, fase]); // eslint-disable-line react-hooks/exhaustive-deps
  const enNiveles = modo === 'niveles';
  const eligiendo = enNiveles && fase === 'elegir';
  const oroAhora = esOro(conf, n);
  const ultimo = numNivel >= NIVELES.length;

  return (
    <Escena colores={ESCENAS.torre} fijo estilo={{ paddingHorizontal: 0, gap: 10 }}>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <ControlesSensaciones izquierda={enNiveles ? (eligiendo ? null : <>
          <Marcador sf="square.stack.3d.up.fill" texto={`Nivel ${numNivel}`} />
          <Marcador sf="star.fill" texto={`${perfectos}`} etiqueta={`${perfectos} perfectos`} />
        </>) : <Marcador sf="trophy.fill" texto={`Récord ${record}`} />} />
        <OpcionesJuego opciones={MODOS} valor={modo} alCambiar={cambiarModo} />
      </View>

      <View style={{ flex: 1 }} onLayout={medir}>
        {geo && !eligiendo ? (
          <GestureDetector gesture={gesto}>
            <View style={{ flex: 1 }} accessible accessibilityRole="button"
              accessibilityLabel={acabado ? `La torre llegó a ${puntos} pisos` : `Torre de ${puntos} pisos${conf.meta ? ` de ${conf.meta}` : ''}. Toca para soltar el bloque`}>
              <Canvas style={{ flex: 1 }}>
                <Cielo ancho={geo.W} alto={geo.A} camara={camara} pisoAlto={geo.H} />
                <Group transform={zoomT} origin={vec(geo.W / 2, geo.baseY)}>
                  <Group transform={camaraT}>
                    {/* La torre hecha es UNA imagen grabada al soltar cada bloque:
                        mientras el bloque de arriba se mueve, los pisos de abajo no
                        se vuelven a armar en cada cuadro. */}
                    <Picture picture={torrePic} />

                    {/* La meta del nivel: una línea punteada a esa altura. */}
                    {conf.meta && !acabado ? (
                      <Rect x={0} y={geo.baseY - (conf.meta + 1) * geo.H - 1} width={geo.W} height={2} color="rgba(255,216,107,0.55)" />
                    ) : null}
                    {/* La guía: dónde caería un perfecto. */}
                    {!acabado && n ? (
                      <RoundedRect x={torre[n - 1].x} y={geo.baseY - (n + 1) * geo.H} width={torre[n - 1].w} height={geo.H} r={7}
                        style="stroke" strokeWidth={1.5} color={oroAhora ? 'rgba(255,216,107,0.5)' : 'rgba(255,255,255,0.22)'} />
                    ) : null}
                    {n ? <Movil posX={posX} ancho={ancho} y={geo.baseY - (n + 1) * geo.H} h={geo.H} i={n} oro={oroAhora} visible={visible} /> : null}
                    {destello ? <Destello key={destello.k} {...destello} /> : null}
                    {piezas.map((p) => <Pieza key={p.id} p={p} caida={geo.A + 200} />)}
                  </Group>
                </Group>
              </Canvas>

              {/* El marcador grande y la racha, encima del cielo. */}
              <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center', gap: 4 }}>
                <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 68, fontWeight: '900', color: BLANCO, fontVariant: ['tabular-nums'],
                  textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 4 } }}>{puntos}</Text>
                {conf.meta ? <Text maxFontSizeMultiplier={1.2} style={{ marginTop: -10, fontSize: 15, fontWeight: '800', color: BLANCO_2 }}>de {conf.meta} pisos</Text> : null}
                <AvisoJuego clave={aviso?.k} texto={aviso && !acabado ? aviso.texto : null} />
                {hayViento && !acabado ? <Marcador sf="wind" texto="Viento" etiqueta="Sopla viento: el bloque acelera y frena" /> : null}
              </View>

              {fase === 'listo' ? (
                <Animated.View pointerEvents="none" entering={FadeIn.delay(250)} exiting={FadeOut}
                  style={{ position: 'absolute', left: 24, right: 24, top: '40%', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: BLANCO, textAlign: 'center' }}>
                    {conf.meta ? `Nivel ${numNivel}: llega a ${conf.meta} pisos` : 'Toca para soltar'}
                  </Text>
                  <Text style={{ ...textoAyuda, textAlign: 'center' }}>
                    {conf.meta
                      ? `Toca para soltar. Con ${Math.ceil(conf.meta * 0.5)} perfectos, tres estrellas.${conf.oro ? ' Los pisos dorados valen doble.' : ''}${conf.viento ? ' Ojo con el viento.' : ''}`
                      : 'Déjalo justo encima para un perfecto. Tres seguidos y el bloque vuelve a crecer.'}
                  </Text>
                </Animated.View>
              ) : null}
            </View>
          </GestureDetector>
        ) : null}

        {eligiendo ? (
          <ScrollView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>
            <SelectorNiveles total={NIVELES.length} progreso={progreso} alElegir={jugarNivel}
              detalle={(k) => { const c = NIVELES[k - 1]; return `${c.meta} pisos${c.viento ? ' · viento' : c.oro ? ' · oro' : ''}`; }} />
            <PanelVidrio>
              <Text style={textoAyuda}>
                Cada torre tiene una meta de pisos y arranca más rápida y más angosta. Desde el nivel 3 hay pisos dorados: un perfecto ahí cuenta doble y devuelve ancho. Desde el 5 sopla viento. Más perfectos, más estrellas.
              </Text>
            </PanelVidrio>
          </ScrollView>
        ) : null}

        {fase === 'fin' ? (
          <Animated.View entering={FadeIn.delay(900).duration(400)} style={{ position: 'absolute', left: 16, right: 16, bottom: 8 }}>
            {enNiveles ? (
              <TarjetaNivel titulo={`${puntos === 1 ? 'Un piso' : `${puntos} pisos`} de ${conf.meta}`}
                texto={`Te faltaron ${conf.meta - puntos}. ¡Casi! Vuelve a intentarlo.`}>
                <BotonJuego sf="arrow.clockwise" alTocar={empezar}>Otra vez</BotonJuego>
                <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={aNiveles}>Niveles</BotonJuego>
              </TarjetaNivel>
            ) : (
              <TarjetaNivel insignia={nuevoRecord ? '¡NUEVO RÉCORD!' : null} titulo={puntos === 1 ? 'Un piso' : `${puntos} pisos`}
                texto={nuevoRecord ? 'Tu torre más alta hasta ahora.' : `Tu récord es de ${record} pisos.`}>
                <BotonJuego sf="arrow.clockwise" alTocar={empezar}>Jugar otra vez</BotonJuego>
              </TarjetaNivel>
            )}
          </Animated.View>
        ) : null}

        {fase === 'gano' && resultado ? (
          <Animated.View entering={FadeIn.delay(700).duration(400)} style={{ position: 'absolute', left: 16, right: 16, bottom: 8 }}>
            <TarjetaNivel estrellas={resultado.estrellas}
              insignia={resultado.mejoro && !resultado.primera ? '¡MÁS ESTRELLAS!' : null}
              titulo={ultimo ? '¡Terminaste todas las torres!' : `¡Nivel ${numNivel} listo!`}
              texto={`${conf.meta} pisos con ${perfectos} ${perfectos === 1 ? 'perfecto' : 'perfectos'}.${resultado.estrellas < 3 ? ` Para tres estrellas: ${Math.ceil(conf.meta * 0.5)}.` : ''}`}>
              {!ultimo ? <BotonJuego sf="play.fill" alTocar={() => jugarNivel(numNivel + 1)}>Siguiente nivel</BotonJuego> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonJuego secundario sf="arrow.clockwise" alTocar={empezar}>Repetir</BotonJuego></View>
                <View style={{ flex: 1 }}><BotonJuego secundario sf="square.grid.2x2.fill" alTocar={aNiveles}>Niveles</BotonJuego></View>
              </View>
            </TarjetaNivel>
          </Animated.View>
        ) : null}

        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', ORO, '#8BE9FF', '#FF9DE6']} alTerminar={() => {}} /> : null}
      </View>
    </Escena>
  );
}
