// El cupón del mes (Platino, 2026-10-07). Tres estados:
//   · Sin raspar: una capa plateada que se raspa con el dedo; debajo, el
//     premio (300, 500 o 1,000 puntos: no se sabe hasta rasparlo).
//   · Vigente: el cupón con un brillo que pasa cada pocos segundos.
//   · Usado: en gris, con el sello «USADO» (o lo que queda, si se usó una parte).
// Se usa en caja como cualquier saldo, mostrando la tarjeta.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Canvas, Group, LinearGradient as SkGradiente, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Icono from './Icono';
import { COLORES_NIVEL } from './TarjetaSocio';
import Mineral, { MATERIALES } from './minerales/Mineral';
import { Confeti } from './animacion';
import { dolares, fecha } from '../lib/formato';

// La línea punteada entre las muescas: por ahí se «corta» al usarlo.
const CORTE = 86;

const clave = (id) => `puntos_salud_cupon_raspado_${String(id).replace(/[^\w-]/g, '')}`;

// `demo` (modo de prueba): cada vez que cambia, el cupón se tapa y se raspa
// solo, para ver la animación completa sin gastar el del mes.
export default function Cupon({ cupon, nivel = 'platino', fondo, activa = true, demo = 0 }) {
  const [raspado, setRaspado] = useState(null); // null = leyendo
  const [festejo, setFestejo] = useState(false);
  const [auto, setAuto] = useState(false);
  // El premio «salta» al descubrirse, y el cupón destella.
  const salto = useSharedValue(1);
  const destello = useSharedValue(0);
  const estiloSalto = useAnimatedStyle(() => ({ transform: [{ scale: salto.value }] }));
  // El cupón lleva el MATERIAL del nivel o del rango (2026-10-08), vivo: sin
  // giroscopio, una luz que va y viene sola sobre las facetas o el metal.
  const luzX = useSharedValue(-0.6);
  const luzY = useSharedValue(0.3);
  useEffect(() => {
    if (!activa) return;
    luzX.value = withRepeat(withTiming(0.6, { duration: 4200, easing: Easing.inOut(Easing.sin) }), -1, true);
    luzY.value = withRepeat(withTiming(-0.3, { duration: 5600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [activa]); // eslint-disable-line react-hooks/exhaustive-deps
  const estiloDestello = useAnimatedStyle(() => ({ opacity: destello.value }));
  useEffect(() => {
    if (!demo) return;
    setRaspado(false); setAuto(true);
  }, [demo]);
  useEffect(() => {
    if (!cupon?.id) return;
    SecureStore.getItemAsync(clave(cupon.id)).catch(() => null).then((v) => setRaspado(v === '1'));
  }, [cupon?.id]);

  // Usado (2026-10-08): las muescas ya decían «por aquí se corta», así que al
  // usarse el cupón se CORTA por la línea punteada: la parte grande se separa
  // del talón con un tirón, se inclina un poco y cae el sello. Si se abre la
  // app con el cupón ya usado, se ve cortado y quieto.
  const usadoAhora = !!cupon && cupon.restantes <= 0;
  const [medida, setMedida] = useState(null);
  const corte = useSharedValue(usadoAhora ? 1 : 0);
  const sello = useSharedValue(usadoAhora ? 1 : 0);
  const antes = useRef(null);
  useEffect(() => {
    if (antes.current === false && usadoAhora) {
      // El «rasgado»: vibraciones cortas seguidas, y el tirón.
      [0, 60, 120, 180, 240].forEach((ms) => setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), ms));
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}), 300);
      corte.value = withSequence(withTiming(-0.12, { duration: 140 }), withTiming(0.05, { duration: 160, easing: Easing.inOut(Easing.quad) }),
        withSpring(1, { damping: 9, stiffness: 140 }));
      sello.value = 0;
      sello.value = withDelay(650, withSpring(1, { damping: 11, stiffness: 260 }));
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 760);
    } else if (!usadoAhora) {
      corte.value = 0; sello.value = 0;
    } else if (antes.current == null) {
      corte.value = 1; sello.value = 1;
    }
    antes.current = usadoAhora;
  }, [usadoAhora]); // eslint-disable-line react-hooks/exhaustive-deps
  const estiloParte = useAnimatedStyle(() => ({
    transform: [{ translateX: corte.value * 12 }, { translateY: corte.value * 4 }, { rotate: `${corte.value * 3}deg` }],
  }));
  const estiloSello = useAnimatedStyle(() => ({
    opacity: Math.min(1, sello.value * 1.4),
    transform: [{ rotate: '-14deg' }, { scale: interpolate(sello.value, [0, 1], [2.6, 1]) }],
  }));

  if (!cupon || raspado == null) return null;
  const usado = usadoAhora;
  const parcial = !usado && cupon.restantes < cupon.puntos;
  const paleta = COLORES_NIVEL[nivel] ?? COLORES_NIVEL.platino;
  const colores = usado ? ['#4A4A4F', '#8C8C93', '#5A5A60'] : paleta.frente;

  const descubrir = () => {
    if (!auto) SecureStore.setItemAsync(clave(cupon.id), '1').catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 180);
    setRaspado(true);
    setAuto(false);
    setFestejo(true);
    salto.value = withSequence(withTiming(0.6, { duration: 0 }), withSpring(1.18, { damping: 6, stiffness: 220 }), withSpring(1, { damping: 12 }));
    destello.value = withSequence(withTiming(0.85, { duration: 120 }), withTiming(0, { duration: 700 }));
  };

  const sello_ = usado ? (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 14, top: 18,
      borderWidth: 3, borderColor: '#FF453A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.08)' }, estiloSello]}>
      <Text style={{ color: '#FF453A', fontSize: 20, fontWeight: '900', letterSpacing: 3 }}>USADO</Text>
    </Animated.View>
  ) : null;

  const cara = (
        <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 104 }}>
          {!usado && MATERIALES.includes(nivel) ? (
            <>
              <Mineral material={nivel} x={luzX} y={luzY} activa={activa} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.22)' }]} />
            </>
          ) : null}
          <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <Icono sf={usado ? 'checkmark.seal.fill' : 'ticket.fill'} respaldo="🎟" tam={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', paddingLeft: 16 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }}>TU CUPÓN DEL MES</Text>
            <Animated.View style={[{ alignSelf: 'flex-start' }, estiloSalto]}>
              <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], textDecorationLine: usado ? 'line-through' : 'none' }}>
                {cupon.descuento ? `${cupon.descuento}% OFF` : dolares((parcial ? cupon.restantes : cupon.puntos) / 100)}
              </Text>
            </Animated.View>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
              {usado ? 'Ya lo usaste. ¡El próximo mes llega otro!'
                : cupon.descuento ? `En una compra, hasta ${dolares(cupon.tope)} · hasta el ${fecha(cupon.vence)}`
                : parcial ? `Te quedan ${dolares(cupon.restantes / 100)} de ${dolares(cupon.puntos / 100)} · hasta el ${fecha(cupon.vence)}`
                  : `Úsalo en caja con tu tarjeta · hasta el ${fecha(cupon.vence)}`}
            </Text>
          </View>
          {!usado && raspado ? <Brillo activa={activa} /> : null}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, estiloDestello]} />
        </LinearGradient>
  );

  return (
    <View>
      {usado && medida ? (
        // Cortado: el talón queda y la parte grande se separa. Las dos son la
        // misma cara recortada, así el corte cae justo en la línea punteada.
        <View style={{ height: medida.alto }}>
          <View style={{ position: 'absolute', left: 0, top: 0, width: CORTE, height: medida.alto, overflow: 'hidden', borderTopLeftRadius: 22, borderBottomLeftRadius: 22 }}>
            <View style={{ width: medida.ancho }}>{cara}</View>
          </View>
          <Animated.View style={[{ position: 'absolute', left: CORTE, top: 0, width: medida.ancho - CORTE, height: medida.alto, overflow: 'hidden',
            borderTopRightRadius: 22, borderBottomRightRadius: 22, transformOrigin: 'left bottom' }, estiloParte]}>
            <View style={{ width: medida.ancho, marginLeft: -CORTE }}>{cara}</View>
            {sello_}
          </Animated.View>
        </View>
      ) : (
        <View style={{ borderRadius: 22, overflow: 'hidden' }}
          onLayout={(e) => setMedida({ ancho: e.nativeEvent.layout.width, alto: e.nativeEvent.layout.height })}>
          {cara}
          {!raspado && !usado ? <Raspable key={`${cupon.id}-${demo}`} alDescubrir={descubrir} auto={auto} /> : null}
          {usado ? sello_ : null}
        </View>
      )}
      {/* Las muescas de un cupón, del color del fondo. */}
      <View style={{ position: 'absolute', left: 78, top: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fondo }} />
      <View style={{ position: 'absolute', left: 78, bottom: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fondo }} />
      {festejo ? <Confeti colores={['#FFD978', '#FFFFFF', '#E8ECF2', '#B5308C']} alTerminar={() => setFestejo(false)} /> : null}
    </View>
  );
}

// El brillo que cruza el cupón vigente cada ~4 s.
function Brillo({ activa }) {
  const x = useSharedValue(-1);
  useEffect(() => {
    if (!activa) return;
    x.value = withRepeat(withSequence(withTiming(-1, { duration: 0 }), withDelay(2600, withTiming(1.4, { duration: 1100, easing: Easing.inOut(Easing.cubic) }))), -1);
  }, [activa, x]);
  const estilo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 360 }, { rotate: '20deg' }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -40, bottom: -40, width: 70 }, estilo]}>
      <LinearGradient colors={['transparent', 'rgba(255,255,255,0.35)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

// La capa para raspar (2026-10-08: más difícil y con más vida). Se mide lo
// raspado por CELDAS y no por largo del trazo —con el largo, tres rayas en el
// mismo sitio contaban como raspar todo—: se descubre con el 70 % de la
// superficie limpia. Mientras se raspa salta polvo plateado del dedo, la
// leyenda se apaga y el teléfono vibra.
const GROSOR = 24;
const COLS = 14;
const FILAS = 5;
const META = 0.7;

function Raspable({ alDescubrir, auto = false }) {
  const [tam, setTam] = useState(null);
  const [trazo, setTrazo] = useState(() => Skia.Path.Make());
  const [polvo, setPolvo] = useState([]);
  const celdas = useRef(new Set());
  const desdeToque = useRef(0);
  const desdePolvo = useRef(0);
  const ultimo = useRef(null);
  const listo = useRef(false);
  const idPolvo = useRef(0);
  const capa = useSharedValue(1);
  const leyenda = useSharedValue(1);

  const marcar = (x, y) => {
    // Las celdas que cubre el círculo del dedo.
    const cw = tam.w / COLS; const ch = tam.h / FILAS; const r = GROSOR / 2;
    for (let cx = Math.max(0, Math.floor((x - r) / cw)); cx <= Math.min(COLS - 1, Math.floor((x + r) / cw)); cx++) {
      for (let cy = Math.max(0, Math.floor((y - r) / ch)); cy <= Math.min(FILAS - 1, Math.floor((y + r) / ch)); cy++) {
        const mx = (cx + 0.5) * cw; const my = (cy + 0.5) * ch;
        if (Math.hypot(mx - x, my - y) <= r + Math.min(cw, ch) * 0.35) celdas.current.add(cy * COLS + cx);
      }
    }
  };

  const agregar = (x, y, nuevo) => {
    if (listo.current || !tam) return;
    const p = trazo.copy();
    if (nuevo || !ultimo.current) {
      p.moveTo(x, y); p.lineTo(x + 0.1, y + 0.1);
      Haptics.selectionAsync().catch(() => {});
      leyenda.value = withTiming(0, { duration: 250 });
      marcar(x, y);
    } else {
      const d = Math.hypot(x - ultimo.current.x, y - ultimo.current.y);
      p.lineTo(x, y);
      // Las celdas del tramo, cada pocos puntos.
      const pasos = Math.max(1, Math.ceil(d / 6));
      for (let k = 1; k <= pasos; k++) marcar(ultimo.current.x + ((x - ultimo.current.x) * k) / pasos, ultimo.current.y + ((y - ultimo.current.y) * k) / pasos);
      desdeToque.current += d;
      if (desdeToque.current > 28) { desdeToque.current = 0; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }
      desdePolvo.current += d;
      if (desdePolvo.current > 18) {
        desdePolvo.current = 0;
        const nuevos = Array.from({ length: 3 }, () => ({ id: idPolvo.current++, x, y, dx: (Math.random() - 0.5) * 70, dy: 10 + Math.random() * 50, t: 3 + Math.random() * 4 }));
        setPolvo((v) => [...v.slice(-24), ...nuevos]);
      }
    }
    ultimo.current = { x, y };
    setTrazo(p);
    if (celdas.current.size >= COLS * FILAS * META) {
      listo.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      capa.value = withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }, (fin) => { if (fin) runOnJS(alDescubrir)(); });
    }
  };
  const soltar = () => { ultimo.current = null; };

  // Modo demostración: un dedo invisible raspa en zigzag.
  useEffect(() => {
    if (!auto || !tam) return undefined;
    let k = 0; const total = 90;
    const t = setInterval(() => {
      if (listo.current || k > total * 1.6) { clearInterval(t); return; }
      const fila = Math.floor(k / 15); const avance = (k % 15) / 14;
      const x = (fila % 2 ? 1 - avance : avance) * tam.w;
      const y = ((fila % (FILAS + 1)) + 0.5) * (tam.h / (FILAS + 1)) + Math.sin(k) * 4;
      agregar(Math.max(4, Math.min(tam.w - 4, x)), y, k === 0);
      k++;
    }, 22);
    return () => clearInterval(t);
  }, [auto, tam]); // eslint-disable-line react-hooks/exhaustive-deps -- `agregar` lee refs

  const gesto = Gesture.Pan().minDistance(0)
    .onBegin((e) => runOnJS(agregar)(e.x, e.y, true))
    .onUpdate((e) => runOnJS(agregar)(e.x, e.y, false))
    .onFinalize(() => runOnJS(soltar)());
  const estilo = useAnimatedStyle(() => ({ opacity: capa.value, transform: [{ scale: 1 + (1 - capa.value) * 0.06 }] }));
  const estiloLeyenda = useAnimatedStyle(() => ({ opacity: leyenda.value }));

  return (
    <GestureDetector gesture={gesto}>
      <Animated.View style={[StyleSheet.absoluteFill, estilo]} onLayout={(e) => setTam({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        accessible accessibilityRole="button" accessibilityLabel="Cupón por descubrir. Raspa con el dedo." accessibilityActions={[{ name: 'activate', label: 'Descubrir' }]}
        onAccessibilityAction={() => { listo.current = true; alDescubrir(); }}>
        {tam ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Group layer>
              <Rect x={0} y={0} width={tam.w} height={tam.h}>
                <SkGradiente start={vec(0, 0)} end={vec(tam.w, tam.h)} colors={['#B9BEC6', '#ECEFF3', '#A4AAB3', '#DDE1E7', '#B0B6BF']} />
              </Rect>
              <Path path={trazo} style="stroke" strokeWidth={GROSOR} strokeCap="round" strokeJoin="round" blendMode="clear" color="black" />
            </Group>
          </Canvas>
        ) : null}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 4 }, estiloLeyenda]}>
          <Icono sf="hand.draw.fill" respaldo="👆" tam={22} color="#5A606A" />
          <Text style={{ color: '#4A505A', fontSize: 15, fontWeight: '900', letterSpacing: 2 }}>RASPA TU CUPÓN</Text>
          <Text style={{ color: '#5A606A', fontSize: 12, fontWeight: '600' }}>¿Cuánto ganaste este mes?</Text>
        </Animated.View>
        {polvo.map((q) => <Particula key={q.id} q={q} alTerminar={() => setPolvo((v) => v.filter((z) => z.id !== q.id))} />)}
      </Animated.View>
    </GestureDetector>
  );
}

// Una pizca de polvo plateado que salta del dedo y cae.
function Particula({ q, alTerminar }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }, (fin) => { if (fin) runOnJS(alTerminar)(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const estilo = useAnimatedStyle(() => ({
    opacity: 1 - v.value,
    transform: [{ translateX: q.dx * v.value }, { translateY: q.dy * v.value * v.value }, { rotate: `${v.value * 200}deg` }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: q.x - q.t / 2, top: q.y - q.t / 2, width: q.t, height: q.t, borderRadius: 1.5, backgroundColor: '#C9CED6' }, estilo]} />
  );
}
