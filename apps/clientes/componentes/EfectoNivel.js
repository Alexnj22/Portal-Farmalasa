// El acabado de la tarjeta según el nivel (2026-10-07: «más distintivos, con
// efectos»). Encima del degradado y debajo del texto:
//   · Plata: metal cepillado (líneas finas).
//   · Oro: destellos que titilan.
//   · Platino: holograma que cambia con la inclinación + destellos.
// Los destellos sólo se animan con la tarjeta a la vista y sin «Reducir
// movimiento»; el holograma sigue al giroscopio que ya mueve la tarjeta.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

// Posiciones fijas (en %): con azar, cada render las movería.
const DESTELLOS = [
  [8, 18, 3], [22, 70, 2], [35, 30, 4], [48, 82, 2], [60, 12, 3], [72, 55, 2], [85, 28, 4], [92, 76, 2],
  [15, 48, 2], [40, 60, 3], [55, 40, 2], [78, 88, 3], [28, 8, 2], [66, 70, 4], [88, 45, 2], [5, 85, 3],
];

export default function EfectoNivel({ nivel, activa, x }) {
  if (nivel === 'plata') return <Cepillado />;
  if (nivel === 'oro') return <Destellos activa={activa} color="#FFF6D5" />;
  if (nivel === 'platino') return (<><Holograma x={x} /><Destellos activa={activa} color="#E8ECF2" /></>);
  // Mayorista: el brillo de cada piedra; el Diamante, con holograma.
  if (nivel === 'jade') return <><Cepillado /><Destellos activa={activa} color="#D8FFF0" /></>;
  if (nivel === 'zafiro') return <Destellos activa={activa} color="#D6E3FF" />;
  if (nivel === 'rubi') return <Destellos activa={activa} color="#FFD6DE" />;
  if (nivel === 'diamante') return (<><Holograma x={x} /><Destellos activa={activa} color="#FFFFFF" /></>);
  return null;
}

function Cepillado() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {Array.from({ length: 46 }, (_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / 46) * 100}%`, height: 1,
          backgroundColor: i % 3 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)' }} />
      ))}
      <LinearGradient colors={['rgba(255,255,255,0.0)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.0)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

function Destellos({ activa, color }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {DESTELLOS.map(([izq, arriba, tam], i) => <Destello key={i} izq={izq} arriba={arriba} tam={tam} i={i} activa={activa} color={color} />)}
    </View>
  );
}

function Destello({ izq, arriba, tam, i, activa, color }) {
  const v = useSharedValue(0.15);
  useEffect(() => {
    if (!activa) { cancelAnimation(v); v.value = 0.25; return; }
    v.value = withDelay((i * 230) % 2000, withRepeat(withSequence(
      withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }),
      withTiming(0.1, { duration: 900, easing: Easing.in(Easing.quad) }),
      withTiming(0.1, { duration: 900 + (i % 5) * 300 }),
    ), -1));
  }, [activa, i, v]);
  const estilo = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.6 + v.value * 0.6 }, { rotate: '45deg' }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: `${izq}%`, top: `${arriba}%`, width: tam * 2, height: tam * 2,
      backgroundColor: color, borderRadius: 1, shadowColor: color, shadowOpacity: 1, shadowRadius: 4 }, estilo]} />
  );
}

function Holograma({ x }) {
  const estilo = useAnimatedStyle(() => ({
    // Sutil: el negro del Platino tiene que seguir siendo negro.
    opacity: 0.05 + Math.min(0.12, Math.abs(x?.value ?? 0) * 0.25),
    transform: [{ translateX: (x?.value ?? 0) * 60 }, { rotate: '-20deg' }, { scale: 1.6 }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Animated.View style={[StyleSheet.absoluteFill, estilo]}>
        <LinearGradient colors={['#F2D7FF', '#D5F6FF', '#FFF1D2', '#E6E0FF', '#F2D7FF']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}
