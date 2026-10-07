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
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Icono from './Icono';
import { COLORES_NIVEL } from './TarjetaSocio';
import { Confeti } from './animacion';
import { dolares, fecha } from '../lib/formato';

const clave = (id) => `puntos_salud_cupon_raspado_${String(id).replace(/[^\w-]/g, '')}`;

export default function Cupon({ cupon, nivel = 'platino', fondo, activa = true }) {
  const [raspado, setRaspado] = useState(null); // null = leyendo
  const [festejo, setFestejo] = useState(false);
  useEffect(() => {
    if (!cupon?.id) return;
    SecureStore.getItemAsync(clave(cupon.id)).catch(() => null).then((v) => setRaspado(v === '1'));
  }, [cupon?.id]);
  if (!cupon || raspado == null) return null;
  const usado = cupon.restantes <= 0;
  const parcial = !usado && cupon.restantes < cupon.puntos;
  const paleta = COLORES_NIVEL[nivel] ?? COLORES_NIVEL.platino;
  const colores = usado ? ['#4A4A4F', '#8C8C93', '#5A5A60'] : paleta.frente;

  const descubrir = () => {
    SecureStore.setItemAsync(clave(cupon.id), '1').catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setRaspado(true);
    setFestejo(true);
  };

  return (
    <View>
      <View style={{ borderRadius: 22, overflow: 'hidden' }}>
        <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 104 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <Icono sf={usado ? 'checkmark.seal.fill' : 'ticket.fill'} respaldo="🎟" tam={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', paddingLeft: 16 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }}>TU CUPÓN DEL MES</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], textDecorationLine: usado ? 'line-through' : 'none' }}>
              {dolares((parcial ? cupon.restantes : cupon.puntos) / 100)}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
              {usado ? 'Ya lo usaste. ¡El próximo mes llega otro!'
                : parcial ? `Te quedan ${dolares(cupon.restantes / 100)} de ${dolares(cupon.puntos / 100)} · hasta el ${fecha(cupon.vence)}`
                  : `Úsalo en caja con tu tarjeta · hasta el ${fecha(cupon.vence)}`}
            </Text>
          </View>
          {!usado && raspado ? <Brillo activa={activa} /> : null}
          {usado ? (
            <View pointerEvents="none" style={{ position: 'absolute', right: 14, top: 18, transform: [{ rotate: '-14deg' }],
              borderWidth: 3, borderColor: '#FF453A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ color: '#FF453A', fontSize: 20, fontWeight: '900', letterSpacing: 3 }}>USADO</Text>
            </View>
          ) : null}
        </LinearGradient>
        {!raspado && !usado ? <Raspable alDescubrir={descubrir} /> : null}
      </View>
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

// La capa para raspar: plateada; el dedo la va borrando. Con la mitad
// raspada, se descubre sola.
function Raspable({ alDescubrir }) {
  const [tam, setTam] = useState(null);
  const [trazo, setTrazo] = useState(() => Skia.Path.Make());
  const largo = useRef(0);
  const ultimo = useRef(null);
  const listo = useRef(false);
  const capa = useSharedValue(1);
  const GROSOR = 34;

  const agregar = (x, y, nuevo) => {
    if (listo.current || !tam) return;
    const p = trazo.copy();
    if (nuevo || !ultimo.current) { p.moveTo(x, y); p.lineTo(x + 0.1, y + 0.1); }
    else { p.lineTo(x, y); largo.current += Math.hypot(x - ultimo.current.x, y - ultimo.current.y); }
    ultimo.current = { x, y };
    setTrazo(p);
    if (largo.current > (tam.w * tam.h) / GROSOR * 0.5) {
      listo.current = true;
      capa.value = withTiming(0, { duration: 350 }, (fin) => { if (fin) runOnJS(alDescubrir)(); });
    }
  };
  const gesto = Gesture.Pan().minDistance(0)
    .onBegin((e) => runOnJS(agregar)(e.x, e.y, true))
    .onUpdate((e) => runOnJS(agregar)(e.x, e.y, false));
  const estilo = useAnimatedStyle(() => ({ opacity: capa.value }));

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
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 4 }]}>
          <Icono sf="hand.draw.fill" respaldo="👆" tam={22} color="#5A606A" />
          <Text style={{ color: '#4A505A', fontSize: 15, fontWeight: '900', letterSpacing: 2 }}>RASPA TU CUPÓN</Text>
          <Text style={{ color: '#5A606A', fontSize: 12, fontWeight: '600' }}>¿Cuánto ganaste este mes?</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
