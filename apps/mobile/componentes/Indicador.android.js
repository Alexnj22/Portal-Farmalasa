// Android: el indicador de carga de Material 3 Expressive — la forma que se
// transforma mientras gira (LoadingIndicator de Compose) — en vez del círculo
// viejo de la plataforma que dibuja el `ActivityIndicator` de React Native
// (2026-11-13, «TODO debe ser material nuevo en android»).
//
// Misma firma que `ActivityIndicator` (`size`, `color`, `style`, `animating`),
// así las ~100 pantallas sólo cambian el import. El color, si la pantalla no
// trae uno, es el primario de la paleta del sistema leída en vivo
// (tema/material.js): el del Host está congelado desde que cargó el WebView.
import { View } from 'react-native';
import { Host, LoadingIndicator } from '@expo/ui/jetpack-compose';
import { size as tamano } from '@expo/ui/jetpack-compose/modifiers';
import { SEMILLA, usePaleta } from '../tema/material';

// `small` de React Native mide 20 y `large` 36; la forma de Material necesita
// un poco más de aire para leerse.
const LADO = { small: 32, large: 48 };

export default function Indicador({ size = 'small', color, style, animating = true, testID }) {
  const paleta = usePaleta();
  if (!animating) return null;
  const lado = typeof size === 'number' ? size : (LADO[size] ?? LADO.small);
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center' }, style]} testID={testID}
      accessibilityRole="progressbar" accessibilityLabel="Cargando">
      <Host seedColor={SEMILLA} style={{ width: lado, height: lado }}>
        <LoadingIndicator color={color ?? paleta?.primary} modifiers={[tamano(lado, lado)]} />
      </Host>
    </View>
  );
}
