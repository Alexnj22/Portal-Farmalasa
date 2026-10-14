// «Momentos con sensación» (2026-10-14, aprobado por el usuario): cuando el
// cliente GANA puntos (la tarjeta cuenta el saldo nuevo) y cuando SUBE de
// nivel o de rango (SubisteDeNivel), el teléfono responde con un patrón
// háptico propio y una animación corta que cambia según el material:
//
//   · Bronce y Plata — sencillo: un toque leve y un resplandor suave.
//   · Oro — la notificación de éxito y una ráfaga de destellos dorados.
//   · Platino — lo más rico: un barrido holográfico que cruza la pieza y un
//     háptico en capas (leve → medio → firme → éxito).
//   · Mayoreo (Jade, Zafiro, Rubí, Diamante) — destellos en el color de la
//     piedra y el éxito con un eco suave.
//
// Todo dura menos de 1.2 s. Con «Reducir movimiento» o en un teléfono liviano
// sólo va el háptico: la animación no se monta.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSinMovimiento } from './animacion';

const GEMAS = { jade: '#8CF5CE', zafiro: '#A9C2FF', rubi: '#FF9AAE', diamante: '#EAF6FF' };
const DURACION = 1100;

export function tipoMomento(material) {
  if (material === 'platino') return 'platino';
  if (material === 'oro') return 'oro';
  if (GEMAS[material]) return 'gema';
  return 'simple';
}

function colorDe(material) {
  if (material === 'oro') return '#FFD978';
  if (material === 'platino') return '#E8ECF2';
  if (GEMAS[material]) return GEMAS[material];
  if (material === 'plata') return '#DCE3EC';
  return '#F2B07A';
}

const golpe = (estilo, ms) => setTimeout(() => Haptics.impactAsync(estilo).catch(() => {}), ms);
const exito = (ms) => setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), ms);

/** El patrón háptico del momento. Vale también sin animación. */
export function vibrarMomento(material) {
  const S = Haptics.ImpactFeedbackStyle;
  switch (tipoMomento(material)) {
    case 'platino':
      golpe(S.Light, 0); golpe(S.Medium, 110); golpe(S.Rigid ?? S.Heavy, 240); exito(420);
      break;
    case 'oro':
      exito(0); golpe(S.Light, 260);
      break;
    case 'gema':
      exito(0); golpe(S.Soft ?? S.Light, 180);
      break;
    default:
      golpe(S.Light, 0);
  }
}

function Destello({ v, angulo, distancia, tam, color, retraso }) {
  const estilo = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, (v.value * DURACION - retraso) / (DURACION * 0.75)));
    const ida = 1 - Math.pow(1 - p, 3);
    return {
      opacity: p <= 0 ? 0 : p < 0.25 ? p * 4 : (1 - p) * 1.33,
      transform: [
        { translateX: Math.cos(angulo) * distancia * ida },
        { translateY: Math.sin(angulo) * distancia * ida },
        { rotate: '45deg' },
        { scale: 0.4 + Math.sin(p * Math.PI) * 0.9 },
      ],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', width: tam, height: tam, marginLeft: -tam / 2, marginTop: -tam / 2, borderRadius: 1.5,
      backgroundColor: color, shadowColor: color, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }, estilo]} />
  );
}

/**
 * La animación del momento, encima de la pieza que la contiene (tarjeta o
 * disco): llena a su padre y no recibe toques. Se monta una vez por momento
 * (con `key`) y se queda quieta al terminar.
 */
export function Momento({ material, radio = 22 }) {
  const quieto = useSinMovimiento();
  const [caja, setCaja] = useState(null);
  const v = useSharedValue(0);
  useEffect(() => {
    if (quieto) return;
    v.value = withTiming(1, { duration: DURACION, easing: Easing.linear });
  }, [quieto, v]);
  const tipo = tipoMomento(material);
  const color = colorDe(material);
  const brillo = useAnimatedStyle(() => ({ opacity: Math.sin(Math.min(1, v.value * 1.4) * Math.PI) * (tipo === 'simple' ? 0.55 : 0.75) }));
  const barrido = useAnimatedStyle(() => ({
    opacity: v.value > 0 && v.value < 0.85 ? 1 : 0,
    transform: [{ translateX: -1 + v.value * ((caja?.w ?? 300) * 1.9) - (caja?.w ?? 300) * 0.55 }, { rotate: '24deg' }],
  }));
  if (quieto) return null;
  const n = tipo === 'simple' ? 0 : tipo === 'platino' ? 8 : 12;
  const alcance = caja ? Math.min(caja.w, caja.h) * 0.62 : 0;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setCaja({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* El resplandor: el canto se enciende y un velo del color pasa. */}
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radio, borderWidth: 2, borderColor: color, backgroundColor: `${color}22` }, brillo]} />
      {tipo === 'platino' && caja ? (
        // Recortado a la forma de la pieza (la tarjeta o el disco redondo).
        <View style={[StyleSheet.absoluteFill, { borderRadius: radio, overflow: 'hidden' }]}>
          <Animated.View style={[{ position: 'absolute', top: -caja.h * 0.4, bottom: -caja.h * 0.4, left: 0, width: caja.w * 0.45 }, barrido]}>
            <LinearGradient start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill}
              colors={['rgba(255,255,255,0)', 'rgba(125,249,255,0.30)', 'rgba(255,255,255,0.55)', 'rgba(255,110,199,0.30)', 'rgba(180,255,125,0.22)', 'rgba(255,255,255,0)']} />
          </Animated.View>
        </View>
      ) : null}
      {caja && n ? (
        <View style={{ position: 'absolute', left: caja.w / 2, top: caja.h / 2 }}>
          {Array.from({ length: n }, (_, i) => (
            <Destello key={i} v={v} angulo={(i / n) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1)} distancia={alcance * (0.65 + ((i * 37) % 35) / 100)}
              tam={tipo === 'platino' ? 5 : 6 + (i % 3) * 2} color={tipo === 'platino' ? (i % 3 === 0 ? '#7DF9FF' : i % 3 === 1 ? '#FF9DE0' : '#FFFFFF') : color}
              retraso={tipo === 'platino' ? 220 + (i % 4) * 40 : (i % 4) * 45} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
