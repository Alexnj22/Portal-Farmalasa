// La aurora VIVA (iPhone y Android): las manchas del logo se desplazan muy
// lento, dibujadas por la GPU con Skia. El movimiento lo lleva Reanimated en el
// hilo de la interfaz, así que no le cuesta nada a JavaScript ni se traba
// mientras la app carga datos. En la web queda la aurora quieta (Aurora.js).
//
// Lento a propósito: un fondo que se nota moverse distrae; uno que «respira»
// se siente vivo. Un ciclo completo dura entre 18 y 26 s por mancha.
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { BlurMask, Canvas, Circle, Group } from '@shopify/react-native-skia';
import { cancelAnimation, Easing, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import tokens from '@nucleo/constants/tokens.json';

const T = tokens.temas.solid;

// `activa`: se pausa donde quedó cuando no se ve (otra pestaña, app en
// segundo plano) o con «Reducir movimiento»; al volver sigue desde ahí.
function useVaiven(duracion, activa) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!activa) { cancelAnimation(v); return; }
    v.value = withRepeat(withTiming(v.value > 0.5 ? 0 : 1, { duration: duracion, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [v, duracion, activa]);
  return v;
}

export default function Aurora({ activa = true }) {
  const oscuro = useColorScheme() === 'dark';
  const reducir = useReducedMotion();
  const { width: w, height: h } = useWindowDimensions();
  const mover = activa && !reducir;
  const a = useVaiven(18000, mover);
  const b = useVaiven(23000, mover);
  const c = useVaiven(26000, mover);
  const r = Math.max(w, h) * 0.42;

  const verdeX = useDerivedValue(() => w * (0.05 + 0.25 * a.value));
  const verdeY = useDerivedValue(() => h * (0.05 + 0.18 * b.value));
  const magentaX = useDerivedValue(() => w * (0.95 - 0.3 * b.value));
  const magentaY = useDerivedValue(() => h * (0.3 + 0.2 * c.value));
  const verde2X = useDerivedValue(() => w * (0.75 - 0.35 * c.value));
  const verde2Y = useDerivedValue(() => h * (0.95 - 0.15 * a.value));

  const fuerza = oscuro ? 0.42 : 0.3;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: oscuro ? '#0A090E' : '#F5F4F8' }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group opacity={fuerza}>
          <Circle cx={verdeX} cy={verdeY} r={r} color={T['logo-green']}><BlurMask blur={r * 0.6} style="normal" /></Circle>
          <Circle cx={magentaX} cy={magentaY} r={r} color={T['logo-magenta']}><BlurMask blur={r * 0.6} style="normal" /></Circle>
          <Circle cx={verde2X} cy={verde2Y} r={r * 0.85} color={T['logo-green']}><BlurMask blur={r * 0.6} style="normal" /></Circle>
        </Group>
      </Canvas>
    </View>
  );
}
