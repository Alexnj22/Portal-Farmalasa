// El indicador de carga de Material 3 Expressive (2026-10-14): una forma
// redonda con lóbulos que GIRA y se TRANSFORMA en otra —siete lóbulos, cuatro,
// nueve…— dentro de un círculo tonal, en vez de la ruedita fina. Es el
// «LoadingIndicator» de la especificación, para las cargas de pantalla entera.
//
// La forma es un contorno polar r(θ) = R·(1 + a·cos(nθ)) que mezcla dos
// cantidades de lóbulos: así se transforma sin saltos. Corre sólo mientras
// está montado (mientras carga) y lo dibuja Skia en el hilo de la interfaz.
import { useEffect } from 'react';
import { View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { suave, useTema } from '../tema/tema';

// Los lóbulos de cada forma, en orden: galleta de 7, trébol de 4, sol de 9, flor de 5.
const FORMAS = [7, 4, 9, 5];
const PUNTOS = 96;

export default function IndicadorCarga({ color, tam = 'grande' }) {
  const t = useTema();
  const quieto = useReducedMotion();
  const lado = tam === 'grande' ? 48 : 32;
  const c = lado / 2;
  const R = lado * 0.30;
  const fase = useSharedValue(0);
  useEffect(() => {
    if (quieto) return;
    // Una vuelta de las cuatro formas cada 4 s (~650 ms por transformación + pausa).
    fase.value = withRepeat(withTiming(FORMAS.length, { duration: 4000, easing: Easing.linear }), -1, false);
  }, [quieto, fase]);
  const camino = useDerivedValue(() => {
    const f = fase.value;
    const i = Math.floor(f) % FORMAS.length;
    const sig = (i + 1) % FORMAS.length;
    // Se queda en la forma la mitad del tramo y se transforma en la otra mitad,
    // con un resorte aproximado (sale rápido, llega suave).
    const local = f - Math.floor(f);
    const m = local < 0.45 ? 0 : 1 - Math.pow(1 - (local - 0.45) / 0.55, 3);
    const giro = f * Math.PI * 0.9;
    const p = Skia.Path.Make();
    for (let k = 0; k <= PUNTOS; k++) {
      const th = (k / PUNTOS) * Math.PI * 2;
      const r = R * (1 + 0.16 * ((1 - m) * Math.cos(FORMAS[i] * th) + m * Math.cos(FORMAS[sig] * th)));
      const x = c + r * Math.cos(th + giro);
      const y = c + r * Math.sin(th + giro);
      if (k === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.close();
    return p;
  });
  const tinta = color ?? t.color.magenta;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Cargando"
      style={{ width: lado * 1.5, height: lado * 1.5, borderRadius: lado * 0.75, alignItems: 'center', justifyContent: 'center',
        backgroundColor: suave(tinta, t.oscuro ? 0.24 : 0.12) }}>
      <Canvas style={{ width: lado, height: lado }} pointerEvents="none">
        <Path path={camino} color={tinta} />
      </Canvas>
    </View>
  );
}
