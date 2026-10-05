// En la web no hay giroscopio: la tarjeta queda quieta.
import { useSharedValue } from 'react-native-reanimated';

export default function useInclinacion() {
  return { x: useSharedValue(0), y: useSharedValue(0) };
}
