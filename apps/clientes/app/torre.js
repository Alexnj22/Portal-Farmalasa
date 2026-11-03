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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { BlurMask, Canvas, Circle, Group, LinearGradient, RadialGradient, Rect, RoundedRect, Shadow, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, ZoomIn, runOnJS, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { Confeti } from '../componentes/animacion';
import { BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, PanelVidrio, textoAyuda } from '../componentes/juegos/Escena';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const CLAVE = 'puntos_salud_torre_record';
const SONIDOS = ['bloque', 'derrumbe', 'ganar', 'toque-1', 'toque-2', 'toque-3', 'toque-4', 'toque-5', 'toque-6'];
const TOLERANCIA = 6; // puntos de perdón para contar un perfecto (a 390 de ancho)
const RECUPERA = 12; // ancho que devuelve cada perfecto desde el tercero seguido

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

const Bloque = memo(function Bloque({ x, y, w, h, i }) {
  const [c1, c2, c3] = tono(i);
  return (
    <Group>
      <RoundedRect x={x} y={y} width={w} height={h} r={7}>
        <LinearGradient start={vec(0, y)} end={vec(0, y + h)} colors={[c1, c2, c3]} />
        <Shadow dx={0} dy={3} blur={6} color="rgba(0,0,0,0.35)" />
      </RoundedRect>
      <RoundedRect x={x + 5} y={y + 3} width={Math.max(0, w - 10)} height={Math.max(2, h * 0.16)} r={3} color="rgba(255,255,255,0.5)" />
    </Group>
  );
});

// El bloque que va y viene: x y ancho son valores del hilo de la interfaz.
function Movil({ posX, ancho, y, h, i, visible }) {
  const [c1, c2, c3] = tono(i);
  const x2 = useDerivedValue(() => posX.value + 5);
  const w2 = useDerivedValue(() => Math.max(0, ancho.value - 10));
  return (
    <Group opacity={visible}>
      <RoundedRect x={posX} y={y} width={ancho} height={h} r={7}>
        <LinearGradient start={vec(0, y)} end={vec(0, y + h)} colors={[c1, c2, c3]} />
        <Shadow dx={0} dy={0} blur={14} color={`${c1}AA`} />
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
      <Bloque x={p.x} y={p.y} w={p.w} h={p.h} i={p.i} />
    </Group>
  );
}

// El destello de un perfecto: un marco de luz que se abre y se apaga.
function Destello({ x, y, w, h }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }); }, [t]);
  const ix = useDerivedValue(() => x - t.value * 18);
  const iy = useDerivedValue(() => y - t.value * 12);
  const iw = useDerivedValue(() => w + t.value * 36);
  const ih = useDerivedValue(() => h + t.value * 24);
  const op = useDerivedValue(() => (1 - t.value) * 0.95);
  return (
    <RoundedRect x={ix} y={iy} width={iw} height={ih} r={12} style="stroke" strokeWidth={3} color="#FFFFFF" opacity={op}>
      <BlurMask blur={4} style="solid" />
    </RoundedRect>
  );
}

function Cielo({ ancho, alto, camara, pisoAlto }) {
  // Estrellas que aparecen a medida que se sube, con un poco de paralaje.
  const estrellas = useMemo(() => {
    let s = 7; const azar = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    return Array.from({ length: 110 }, () => ({ x: azar() * ancho, y: alto - azar() * alto * 6, r: 0.6 + azar() * 1.6, a: 0.35 + azar() * 0.65 }));
  }, [ancho, alto]);
  const paralaje = useDerivedValue(() => [{ translateY: camara.value * 0.3 }]);
  const brillo = useDerivedValue(() => Math.min(1, 0.15 + camara.value / (pisoAlto * 18)));
  const noche = useDerivedValue(() => Math.min(0.72, camara.value / (pisoAlto * 40)));
  return (
    <Group>
      <Rect x={0} y={0} width={ancho} height={alto} color="#03041A" opacity={noche} />
      <Group transform={paralaje} opacity={brillo}>
        {estrellas.map((e, k) => <Circle key={k} cx={e.x} cy={e.y} r={e.r} color={`rgba(255,255,255,${e.a})`} />)}
      </Group>
    </Group>
  );
}

export default function Torre() {
  const [geo, setGeo] = useState(null);
  const geoRef = useRef(null);
  const [fase, setFase] = useState('listo'); // listo · jugando · fin
  const [torre, setTorre] = useState([]);
  const torreRef = useRef([]);
  const [piezas, setPiezas] = useState([]);
  const [destello, setDestello] = useState(null);
  const [combo, setCombo] = useState(0);
  const comboRef = useRef(0);
  const [record, setRecord] = useState(0);
  const recordRef = useRef(0);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const [festejo, setFestejo] = useState(0);
  const idPieza = useRef(0);
  const relojes = useRef([]);

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

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v) || 0; recordRef.current = n; setRecord(n); }).catch(() => {});
    return () => { moviendo.value = false; relojes.current.forEach(clearTimeout); callar(SONIDOS); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const luego = (fn, ms) => { relojes.current.push(setTimeout(fn, ms)); };

  useFrameCallback((f) => {
    if (!moviendo.value) return;
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    let x = posX.value + dir.value * vel.value * dt;
    if (x > maxX.value) { x = maxX.value; dir.value = -1; } else if (x < minX.value) { x = minX.value; dir.value = 1; }
    posX.value = x;
  });

  const lanzar = useCallback((n, w) => {
    const g = geoRef.current;
    ancho.value = w;
    minX.value = -w * 0.3;
    maxX.value = g.W - w * 0.7;
    const desdeIzquierda = n % 2 === 1;
    posX.value = desdeIzquierda ? minX.value : maxX.value;
    dir.value = desdeIzquierda ? 1 : -1;
    vel.value = Math.min(g.W * 1.15, g.W * (0.42 + n * 0.018));
    visible.value = 1;
    moviendo.value = true;
  }, [ancho, dir, maxX, minX, moviendo, posX, vel, visible]);

  const empezar = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    const inicial = [{ x: (g.W - g.W0) / 2, w: g.W0, i: 0 }];
    torreRef.current = inicial;
    setTorre(inicial);
    setPiezas([]);
    setDestello(null);
    comboRef.current = 0; setCombo(0);
    setNuevoRecord(false);
    zoom.value = withTiming(1, { duration: 450 });
    camara.value = withTiming(0, { duration: 450 });
    setFase('listo');
    lanzar(1, g.W0);
  }, [camara, lanzar, zoom]);

  const terminar = useCallback((puntos) => {
    const g = geoRef.current;
    setFase('fin');
    visible.value = withTiming(0, { duration: 200 });
    sonar('derrumbe');
    tacto.aviso();
    luego(() => tacto.golpe(), 180);
    // La cámara se aleja hasta que la torre entera entra en la pantalla.
    const altoTorre = (puntos + 3) * g.H;
    const cabe = Math.min(1, (g.A * 0.62) / altoTorre);
    luego(() => {
      camara.value = withTiming(0, { duration: 1300, easing: Easing.inOut(Easing.cubic) });
      zoom.value = withTiming(cabe, { duration: 1300, easing: Easing.inOut(Easing.cubic) });
    }, 450);
    if (puntos > recordRef.current) {
      recordRef.current = puntos; setRecord(puntos); setNuevoRecord(true);
      SecureStore.setItemAsync(CLAVE, String(puntos)).catch(() => {});
      luego(() => { sonar('ganar'); tacto.exito(); setFestejo((k) => k + 1); }, 700);
    }
  }, [camara, visible, zoom]);

  const soltar = useCallback((x) => {
    const g = geoRef.current;
    const t = torreRef.current;
    if (!g || !t.length) return;
    if (fase === 'listo') setFase('jugando');
    const previo = t[t.length - 1];
    const n = t.length;
    const w = ancho.value;
    const y = g.baseY - (n + 1) * g.H;
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
      setPiezas((p) => [...p, { id, x: xx, y, w, h: g.H, i: n, giro: xx < previo.x ? -1.4 : 1.4 }]);
      luego(quitar, 1200);
      terminar(n - 1);
      return;
    }

    const bloque = { x: izquierda, w: solapa, i: n };
    if (perfecto) {
      const c = comboRef.current + 1;
      comboRef.current = c; setCombo(c);
      if (c >= 3 && bloque.w < g.W0) {
        const nuevo = Math.min(g.W0, bloque.w + RECUPERA * g.escala);
        bloque.x -= (nuevo - bloque.w) / 2; bloque.w = nuevo;
      }
      setDestello({ k: id, x: bloque.x, y, w: bloque.w, h: g.H });
      sonar(`toque-${Math.min(6, c)}`);
      sonar('bloque', { volumen: 0.45 });
      tacto.golpe();
    } else {
      comboRef.current = 0; setCombo(0);
      const corte = xx < previo.x ? { x: xx, w: previo.x - xx } : { x: derecha, w: xx + w - derecha };
      setPiezas((p) => [...p, { id, ...corte, y, h: g.H, i: n, giro: xx < previo.x ? -1.1 : 1.1 }]);
      luego(quitar, 1200);
      sonar('bloque', { tono: 0.92 + Math.random() * 0.16 });
      tacto.toque();
    }

    const nueva = [...t, bloque];
    torreRef.current = nueva;
    setTorre(nueva);
    const puntos = nueva.length - 1;
    if (puntos % 10 === 0) { luego(() => { sonar('ganar', { volumen: 0.7 }); tacto.exito(); }, 120); setFestejo((k) => k + 1); }
    // La cámara sube para que la punta quede siempre a la misma altura.
    const meta = Math.max(0, (nueva.length - g.pisosVisibles) * g.H);
    camara.value = withTiming(meta, { duration: 380, easing: Easing.out(Easing.cubic) });
    lanzar(n + 1, bloque.w);
  }, [ancho, camara, fase, lanzar, terminar]);

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
  useEffect(() => { if (geo) empezar(); }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  const camaraT = useDerivedValue(() => [{ translateY: camara.value }]);
  const zoomT = useDerivedValue(() => [{ scale: zoom.value }]);

  const puntos = Math.max(0, torre.length - 1);
  const n = torre.length;
  // Mientras se juega sólo se pintan los últimos pisos; al final, la torre entera.
  const visibles = fase === 'fin' ? torre.slice(-160) : torre.slice(-24);

  return (
    <Escena colores={ESCENAS.torre} fijo estilo={{ paddingHorizontal: 0, gap: 10 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <ControlesSensaciones izquierda={<Marcador sf="trophy.fill" texto={`Récord ${record}`} />} />
      </View>

      <View style={{ flex: 1 }} onLayout={medir}>
        {geo ? (
          <GestureDetector gesture={gesto}>
            <View style={{ flex: 1 }} accessible accessibilityRole="button"
              accessibilityLabel={fase === 'fin' ? `La torre llegó a ${puntos} pisos` : `Torre de ${puntos} pisos. Toca para soltar el bloque`}>
              <Canvas style={{ flex: 1 }}>
                <Cielo ancho={geo.W} alto={geo.A} camara={camara} pisoAlto={geo.H} />
                <Group transform={zoomT} origin={vec(geo.W / 2, geo.baseY)}>
                  <Group transform={camaraT}>
                    {/* La base: un pedestal de vidrio con su resplandor. */}
                    <Circle cx={geo.W / 2} cy={geo.baseY + geo.H} r={geo.W * 0.5}>
                      <RadialGradient c={vec(geo.W / 2, geo.baseY + geo.H)} r={geo.W * 0.5} colors={['rgba(170,190,255,0.35)', 'rgba(170,190,255,0)']} />
                    </Circle>
                    <RoundedRect x={(geo.W - geo.W0) / 2 - 18} y={geo.baseY} width={geo.W0 + 36} height={geo.H * 4} r={14}>
                      <LinearGradient start={vec(0, geo.baseY)} end={vec(0, geo.baseY + geo.H * 3)} colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.06)']} />
                    </RoundedRect>
                    <Rect x={(geo.W - geo.W0) / 2 - 10} y={geo.baseY + 2} width={geo.W0 + 20} height={2} color="rgba(255,255,255,0.7)" />

                    {visibles.map((b) => <Bloque key={b.i} x={b.x} y={geo.baseY - (b.i + 1) * geo.H} w={b.w} h={geo.H} i={b.i} />)}

                    {/* La guía: dónde caería un perfecto. */}
                    {fase !== 'fin' && n ? (
                      <RoundedRect x={torre[n - 1].x} y={geo.baseY - (n + 1) * geo.H} width={torre[n - 1].w} height={geo.H} r={7}
                        style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.22)" />
                    ) : null}
                    {n ? <Movil posX={posX} ancho={ancho} y={geo.baseY - (n + 1) * geo.H} h={geo.H} i={n} visible={visible} /> : null}
                    {destello ? <Destello key={destello.k} {...destello} /> : null}
                    {piezas.map((p) => <Pieza key={p.id} p={p} caida={geo.A + 200} />)}
                  </Group>
                </Group>
              </Canvas>

              {/* El marcador grande y la racha, encima del cielo. */}
              <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center' }}>
                <Text style={{ fontSize: 68, fontWeight: '900', color: BLANCO, fontVariant: ['tabular-nums'],
                  textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 4 } }}>{puntos}</Text>
                {combo >= 1 && fase !== 'fin' ? (
                  <Animated.View key={combo} entering={ZoomIn.springify().damping(9)} exiting={FadeOut}
                    style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}>
                    <Text style={{ fontSize: 15, fontWeight: '900', color: BLANCO }}>{combo > 1 ? `¡Perfecto ×${combo}!` : '¡Perfecto!'}</Text>
                  </Animated.View>
                ) : null}
              </View>

              {fase === 'listo' ? (
                <Animated.View pointerEvents="none" entering={FadeIn.delay(250)} exiting={FadeOut}
                  style={{ position: 'absolute', left: 24, right: 24, top: '36%', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: BLANCO }}>Toca para soltar</Text>
                  <Text style={{ ...textoAyuda, textAlign: 'center' }}>Déjalo justo encima para un perfecto. Tres seguidos y el bloque vuelve a crecer.</Text>
                </Animated.View>
              ) : null}
            </View>
          </GestureDetector>
        ) : null}

        {fase === 'fin' ? (
          <Animated.View entering={FadeIn.delay(900).duration(400)} style={{ position: 'absolute', left: 16, right: 16, bottom: 8 }}>
            <PanelVidrio estilo={{ gap: 12, alignItems: 'center', backgroundColor: 'rgba(10,12,40,0.55)' }}>
              {nuevoRecord ? (
                <View style={{ paddingHorizontal: 12, height: 26, borderRadius: 13, justifyContent: 'center', backgroundColor: '#FFD86B' }}>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: '#3A2A00' }}>¡NUEVO RÉCORD!</Text>
                </View>
              ) : null}
              <Text style={{ fontSize: 20, fontWeight: '800', color: BLANCO }}>
                {puntos === 1 ? 'Un piso' : `${puntos} pisos`}
              </Text>
              <Text style={{ fontSize: 14, color: BLANCO_2 }}>
                {nuevoRecord ? 'Tu torre más alta hasta ahora.' : `Tu récord es de ${record} pisos.`}
              </Text>
              <View style={{ alignSelf: 'stretch' }}>
                <BotonJuego sf="arrow.clockwise" alTocar={empezar}>Jugar otra vez</BotonJuego>
              </View>
            </PanelVidrio>
          </Animated.View>
        ) : null}

        {festejo ? <Confeti key={festejo} colores={['#FFFFFF', '#FFD86B', '#8BE9FF', '#FF9DE6']} alTerminar={() => {}} /> : null}
      </View>
    </Escena>
  );
}
