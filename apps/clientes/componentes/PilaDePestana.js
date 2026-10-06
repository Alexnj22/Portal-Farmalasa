// Cada pestaña lleva su propia pila (la barra de título del sistema, con el
// título grande de iOS) y su propia AURORA detrás: la barra de pestañas de iOS
// pone un fondo negro detrás de cada pestaña y tapa la aurora de la raíz.
// Mismo arreglo que la app del personal (apps/mobile/componentes/PilaDePestana.js).
//
// En iOS 26 el sistema ya difumina el borde al desplazar; un desenfoque propio
// encima se ve doble, así que sólo va en iOS anteriores.
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import Aurora from './Aurora';
import { useVisible } from '../lib/visible';

const IOS26 = Platform.OS === 'ios' && isLiquidGlassAvailable();
export const BARRA_NATIVA = Platform.OS === 'ios'
  ? {
      headerTransparent: true,
      ...(IOS26 ? {} : { headerBlurEffect: 'systemChromeMaterial' }),
      headerShadowVisible: false,
      headerLargeTitleShadowVisible: false,
      headerLargeStyle: { backgroundColor: 'transparent' },
    }
  : { headerShadowVisible: false, headerStyle: { backgroundColor: 'transparent' } };

export default function PilaDePestana({ titulo }) {
  // La aurora de esta pestaña sólo se mueve mientras se ve.
  const visible = useVisible();
  return (
    <View style={{ flex: 1 }}>
      <Aurora activa={visible} />
      <Stack screenOptions={{ headerLargeTitle: Platform.OS === 'ios', contentStyle: { backgroundColor: 'transparent' }, ...BARRA_NATIVA }}>
        <Stack.Screen name="index" options={{ title: titulo }} />
      </Stack>
    </View>
  );
}
