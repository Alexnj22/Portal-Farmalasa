// La inclinación del teléfono, leída del giroscopio en el hilo de la interfaz
// (Reanimated). La tarjeta de socio la usa para mover su brillo y ladearse
// apenas, como una tarjeta de verdad bajo la luz.
import { SensorType, useAnimatedSensor, useDerivedValue } from 'react-native-reanimated';

export default function useInclinacion() {
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: 16 });
  // pitch: adelante/atrás · roll: izquierda/derecha. Acotados a ±0.5 rad.
  const x = useDerivedValue(() => Math.max(-0.5, Math.min(0.5, sensor.sensor.value.roll ?? 0)));
  const y = useDerivedValue(() => Math.max(-0.5, Math.min(0.5, (sensor.sensor.value.pitch ?? 0) - 0.6)));
  return { x, y };
}
