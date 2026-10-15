// La aurora VIVA (iPhone y Android): las manchas del logo se desplazan muy
// lento, dibujadas por la GPU con Skia. El movimiento lo lleva Reanimated en el
// hilo de la interfaz, así que no le cuesta nada a JavaScript ni se traba
// mientras la app carga datos. En la web queda la aurora quieta (Aurora.js).
//
// Lento a propósito: un fondo que se nota moverse distrae; uno que «respira»
// se siente vivo. Un ciclo completo dura entre 18 y 26 s por mancha.
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { Canvas, Circle, Group, RadialGradient, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import tokens from '@nucleo/constants/tokens.json';
import { LIVIANO } from '../lib/rendimiento';
import { useDespierta } from './reposo';

const T = tokens.temas.solid;
// Vaivén de 0 a 1 y de vuelta, suave en los extremos (el `Easing.sin` de antes).
const vaiven = (s, dur) => { 'worklet'; return 0.5 - 0.5 * Math.cos((s / dur) * Math.PI); };

// Las manchas eran círculos con un `BlurMask` de pantalla completa (radio r,
// desenfoque 0.6·r): el desenfoque más caro que hay, tres veces, en cada
// pestaña montada. Ahora cada mancha es un DEGRADADO RADIAL con el mismo perfil
// (2026-10-15): la intensidad de un disco de radio `a` convolucionado con una
// gaussiana de sigma 0.6 (en unidades de r), muestreada en 13 puntos de 0 a
// `a + 1.8` (tres sigmas: más allá ya no queda nada). Medido con la integral,
// no a ojo: el centro de la mancha grande queda en 75 % y no en 100 %, como lo
// dejaba el desenfoque. El último punto va en cero para que no haya borde.
const PASOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => i / 12);
const PERFIL_GRANDE = [0.751, 0.725, 0.651, 0.54, 0.411, 0.283, 0.176, 0.097, 0.048, 0.021, 0.008, 0.003, 0];
const PERFIL_CHICO = [0.633, 0.609, 0.54, 0.441, 0.329, 0.224, 0.137, 0.076, 0.038, 0.017, 0.007, 0.002, 0];
const ALCANCE_GRANDE = 2.8; // r · (1 + 1.8)
const ALCANCE_CHICO = 2.65; // r · (0.85 + 1.8)
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const verdeGrande = PERFIL_GRANDE.map((a) => rgba(T['logo-green'], a));
const magentaGrande = PERFIL_GRANDE.map((a) => rgba(T['logo-magenta'], a));
const verdeChico = PERFIL_CHICO.map((a) => rgba(T['logo-green'], a));

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

  // El mismo centro para el círculo y para su degradado: el degradado se
  // dibuja en las coordenadas del lienzo, no en las del círculo.
  const verde = useDerivedValue(() => vec(w * (0.05 + 0.25 * a.value), h * (0.05 + 0.18 * b.value)));
  const magenta = useDerivedValue(() => vec(w * (0.95 - 0.3 * b.value), h * (0.3 + 0.2 * c.value)));
  const verde2 = useDerivedValue(() => vec(w * (0.75 - 0.35 * c.value), h * (0.95 - 0.15 * a.value)));
  const rG = r * ALCANCE_GRANDE;
  const rC = r * ALCANCE_CHICO;

  const fuerza = oscuro ? 0.42 : 0.3;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: oscuro ? '#0A090E' : '#F5F4F8' }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group opacity={fuerza}>
          {/* Las tres en un solo grupo con la opacidad, como antes: donde se
              cruzan se mezclan igual que las manchas desenfocadas. */}
          <Circle c={verde} r={rG}><RadialGradient c={verde} r={rG} colors={verdeGrande} positions={PASOS} /></Circle>
          <Circle c={magenta} r={rG}><RadialGradient c={magenta} r={rG} colors={magentaGrande} positions={PASOS} /></Circle>
          <Circle c={verde2} r={rC}><RadialGradient c={verde2} r={rC} colors={verdeChico} positions={PASOS} /></Circle>
        </Group>
      </Canvas>
    </View>
  );
}
