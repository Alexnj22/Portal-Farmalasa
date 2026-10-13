// La inclinación del teléfono, leída del giroscopio en el hilo de la interfaz
// (Reanimated). La tarjeta de socio la usa para mover su brillo y ladearse
// apenas, como una tarjeta de verdad bajo la luz.
import { Platform } from 'react-native';
import { SensorType, useAnimatedSensor, useDerivedValue } from 'react-native-reanimated';

// Android (2026-10-13): 30 lecturas por segundo, no 60. Cada lectura mueve los
// lienzos de la tarjeta; el resorte que la suaviza (TarjetaSocio) llena los
// cuadros del medio, así que a la vista es igual y la GPU trabaja la mitad.
const INTERVALO = Platform.OS === 'android' ? 33 : 16;

export default function useInclinacion() {
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: INTERVALO });
  // pitch: adelante/atrás · roll: izquierda/derecha. Acotados a ±0.5 rad.
  const x = useDerivedValue(() => Math.max(-0.5, Math.min(0.5, sensor.sensor.value.roll ?? 0)));
  const y = useDerivedValue(() => Math.max(-0.5, Math.min(0.5, (sensor.sensor.value.pitch ?? 0) - 0.6)));
  return { x, y };
}
