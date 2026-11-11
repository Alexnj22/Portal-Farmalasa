// «Volver» con el gesto de siempre en una pantalla que cambia de estado sin
// navegar (2026-11-11). Usuario: «al tener un filtro, por ejemplo buscar por
// laboratorio, si deslizo el dedo para regresar, no regresa. solo al dar
// volver a la tienda».
//
// Una pestaña es la raíz de su pila: con un filtro puesto no hay pantalla
// anterior a la que volver, así que el deslizar desde el borde de iOS (y el
// «atrás» de Android) no hacía nada. Mientras `activo`, esto escucha las dos
// cosas y llama a `alVolver`:
// - iOS/Android: deslizar desde el borde izquierdo hacia la derecha;
// - Android: el botón o gesto «atrás» del sistema.
import { useEffect } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

const BORDE = 24; // ancho de la franja que escucha, como el del sistema
const DISTANCIA = 70;

export default function VolverConGesto({ activo, alVolver }) {
  useEffect(() => {
    if (!activo || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { alVolver(); return true; });
    return () => sub.remove();
  }, [activo, alVolver]);
  if (!activo || Platform.OS === 'web') return null;
  const gesto = Gesture.Pan()
    .activeOffsetX(12)
    .failOffsetY([-24, 24])
    .onEnd((e) => {
      if (e.translationX > DISTANCIA || e.velocityX > 600) runOnJS(alVolver)();
    });
  return (
    <GestureDetector gesture={gesto}>
      <View collapsable={false} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: BORDE, zIndex: 50 }} />
    </GestureDetector>
  );
}
