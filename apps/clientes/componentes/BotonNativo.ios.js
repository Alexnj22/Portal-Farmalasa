// El botón del sistema en iPhone, con SwiftUI directo: el universal de @expo/ui
// no deja que la ETIQUETA ocupe el ancho, y un botón principal angosto en el
// centro de la pantalla no es como se ve en iOS (Ajustes, App Store, Wallet).
// Tamaño grande, todo el ancho, y el estilo de vidrio de iOS 26.
import { Button, Host, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, disabled as apagado, frame, tint } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';

const ESTILO = { filled: 'glassProminent', outlined: 'glass', text: 'plain' };

export default function BotonNativo({ etiqueta, alTocar, variante = 'filled', deshabilitado = false, color }) {
  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }} seedColor={variante !== 'outlined' ? color : undefined}>
      <Button
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar?.(); }}
        modifiers={[
          buttonStyle(ESTILO[variante] ?? 'glassProminent'),
          controlSize('large'),
          // El secundario (vidrio) va con el color del sistema: tintado de magenta
          // sobre la aurora verde no se leía.
          ...(color && variante !== 'outlined' ? [tint(String(color).toUpperCase())] : []),
          apagado(deshabilitado),
        ]}
      >
        <Text modifiers={[frame({ maxWidth: 10000 })]}>{etiqueta}</Text>
      </Button>
    </Host>
  );
}
