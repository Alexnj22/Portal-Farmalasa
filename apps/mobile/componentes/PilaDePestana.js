// Cada pestaña lleva su propia pila, que es lo que le da la barra de título del
// sistema (con el título grande de iOS donde corresponde).
//
// La barra es la de iOS de verdad: transparente arriba y con el vidrio del
// sistema cuando el contenido pasa por debajo, como Ajustes o Mensajes. Con un
// fondo de color fijo (lo que había) se veía blanca al desplazar, y el título
// grande salía oscuro sobre oscuro en modo oscuro (usuario, 2026-09-30).
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import ConAurora from './ConAurora';

// En iOS 26 el sistema ya pone su «borde suave» al desplazar (scroll edge
// effect): sumarle un desenfoque propio los encima y se ve doble. El
// desenfoque queda sólo para iOS anteriores.
const IOS26 = Platform.OS === 'ios' && isLiquidGlassAvailable();
export const BARRA_NATIVA = Platform.OS === 'ios'
  ? { headerTransparent: true, ...(IOS26 ? {} : { headerBlurEffect: 'systemChromeMaterial' }), headerShadowVisible: false, headerLargeTitleShadowVisible: false, headerLargeStyle: { backgroundColor: 'transparent' } }
  : {};

// `sinBarra`: la pestaña muestra el portal, que ya trae su propio título.
export default function PilaDePestana({ titulo, grande = false, sinBarra = false }) {
  return (
    <ConAurora>
    <Stack screenOptions={{ headerLargeTitle: grande, contentStyle: { backgroundColor: 'transparent' }, ...BARRA_NATIVA }}>
      <Stack.Screen name="index" options={{ title: titulo, headerShown: !sinBarra }} />
    </Stack>
    </ConAurora>
  );
}
