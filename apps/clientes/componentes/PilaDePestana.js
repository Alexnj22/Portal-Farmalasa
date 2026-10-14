// Cada pestaña lleva su propia pila (la barra de título del sistema, con el
// título grande de iOS) y su propia AURORA detrás: la barra de pestañas de iOS
// pone un fondo negro detrás de cada una y tapa la aurora de la raíz.
// Mismo arreglo que la app del personal (apps/mobile/componentes/PilaDePestana.js).
//
// En iOS 26 el sistema ya difumina el borde al desplazar; un desenfoque propio
// encima se ve doble, así que sólo va en iOS anteriores.
//
// Android (2026-10-13): sin aurora. La pantalla y la barra de arriba son
// OPACAS, en la superficie de Material 3 (`colorSistema.fondo`): la barra es
// la «top app bar» chica de Material —título a la izquierda, 22 sp, flecha
// de volver—, sin títulos grandes ni transparencias.
import { Platform, useColorScheme, View } from 'react-native';
import { Stack } from 'expo-router';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import Aurora from './Aurora';
import { colorSistema } from './sistema';
import { useVisible } from '../lib/visible';

const ANDROID = Platform.OS === 'android';
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

/**
 * Android: la barra y el fondo de Material, opacos. Es función y no constante
 * porque los colores siguen el modo oscuro: quien la usa ya se repinta con
 * `useColorScheme`.
 */
// `principal` (2026-10-14, Material 3 Expressive): las pantallas raíz de cada
// pestaña llevan el título ENFATIZADO —Headline Small en peso fuerte, 26 sp—;
// las de adentro, el Title Large enfatizado (22 sp, medio).
export function barraAndroid(principal = false) {
  return {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colorSistema.fondo },
    headerTitleAlign: 'left',
    headerTitleStyle: principal
      ? { color: colorSistema.texto, fontSize: 26, fontWeight: '700' }
      : { color: colorSistema.texto, fontSize: 22, fontWeight: '500' },
    contentStyle: { backgroundColor: colorSistema.fondo },
  };
}

// `auroraQuieta` (Inicio, 2026-10-14, «se siente lento»): la aurora se dibuja
// una vez y no se anima. Detrás de una lista larga que se desplaza, cada
// cuadro de la aurora obligaba a recomponer todo lo translúcido de encima; y
// como las manchas se mueven tan lento, quieta se ve igual.
export default function PilaDePestana({ titulo, auroraQuieta = false }) {
  useColorScheme();
  // La aurora de esta pestaña sólo se mueve mientras se ve.
  const visible = useVisible() && !auroraQuieta;
  if (ANDROID) {
    return (
      <View style={{ flex: 1, backgroundColor: colorSistema.fondo }}>
        <Stack screenOptions={barraAndroid(true)}>
          <Stack.Screen name="index" options={{ title: titulo }} />
        </Stack>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <Aurora activa={visible} />
      <Stack screenOptions={{ headerLargeTitle: Platform.OS === 'ios', contentStyle: { backgroundColor: 'transparent' }, ...BARRA_NATIVA }}>
        <Stack.Screen name="index" options={{ title: titulo }} />
      </Stack>
    </View>
  );
}
