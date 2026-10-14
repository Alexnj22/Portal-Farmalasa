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
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import tokens from '@nucleo/constants/tokens.json';
import { LIVIANO } from '../lib/rendimiento';
import { useDespierta } from './reposo';

const T = tokens.temas.solid;
// Vaivén de 0 a 1 y de vuelta, suave en los extremos (el `Easing.sin` de antes).
const vaiven = (s, dur) => { 'worklet'; return 0.5 - 0.5 * Math.cos((s / dur) * Math.PI); };

export default function Aurora({ activa = true }) {
  const oscuro = useColorScheme() === 'dark';
  // En un teléfono viejo (lib/rendimiento) la aurora queda quieta: dibujada
  // una vez, sin animar las manchas cada cuadro (2026-10-13).
  const reducir = useReducedMotion() || LIVIANO;
  const { width: w, height: h } = useWindowDimensions();
  // UN reloj a 15 cuadros por segundo, y en reposo a los 20 s sin tocar
  // (2026-10-14, «se calienta»). Antes eran tres `withRepeat` infinitos que
  // redibujaban tres círculos con desenfoque de pantalla completa a la
  // frecuencia de la pantalla —120 veces por segundo en ProMotion— durante
  // todo el chat o cualquier pantalla de la pila. Una mancha que cruza la
  // pantalla en 20 s se mueve menos de un punto entre cuadro y cuadro: a 15
  // por segundo se ve idéntica.
  const mover = useDespierta(activa && !reducir);
  const s = useSharedValue(0);
  const acum = useSharedValue(0);
  const reloj = useFrameCallback((f) => {
    acum.value += Math.min(0.1, (f.timeSincePreviousFrame ?? 16) / 1000);
    if (acum.value >= 0.066) { s.value += acum.value; acum.value = 0; }
  }, false);
  useEffect(() => { reloj.setActive(mover); }, [mover, reloj]);
  const a = useDerivedValue(() => vaiven(s.value, 18));
  const b = useDerivedValue(() => vaiven(s.value, 23));
  const c = useDerivedValue(() => vaiven(s.value, 26));
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
