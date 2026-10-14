// La inclinación del teléfono, leída del giroscopio en el hilo de la interfaz
// (Reanimated). La tarjeta de socio la usa para mover su brillo y ladearse
// apenas, como una tarjeta de verdad bajo la luz.
import { SensorType, useAnimatedSensor, useDerivedValue } from 'react-native-reanimated';

// 30 lecturas por segundo en los dos sistemas (Android desde el 2026-10-13,
// iPhone desde el 2026-10-14, «se calienta»). El resorte que la suaviza
// (TarjetaSocio) llena los cuadros del medio, así que a la vista es igual.
// `intervalo`: en reposo la tarjeta pide una lectura cada 250 ms, sólo para
// darse cuenta de que la volvieron a inclinar (componentes/reposo.js).
export default function useInclinacion(intervalo = 33) {
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: intervalo });
  // pitch: adelante/atrás · roll: izquierda/derecha. Acotados a ±0.5 rad.
  const x = useDerivedValue(() => Math.max(-0.5, Math.min(0.5, sensor.sensor.value.roll ?? 0)));
  const y = useDerivedValue(() => Math.max(-0.5, Math.min(0.5, (sensor.sensor.value.pitch ?? 0) - 0.6)));
  return { x, y };
}
