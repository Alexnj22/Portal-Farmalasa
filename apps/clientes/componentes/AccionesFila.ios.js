// Las acciones de una fila de lista, con las piezas de SwiftUI (2026-11-04,
// usuario: «las cards que sean más nativas, en iOS se ve mal, se ve barato»).
//
//   · `MenuMas`: el «⋯» que abre el menú desplegable del sistema (el de
//     Archivos, Notas, Salud), con su ícono y el rojo de lo destructivo.
//   · `Capsula`: el botón chico de vidrio de iOS 26 («Tomar», «Pedir»), el
//     mismo estilo que BotonNativo pero del tamaño de una fila.
//
// Fuera de iPhone, AccionesFila.js hace lo mismo con piezas de React Native.
import { Button, Host, Menu, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, labelStyle, tint } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';

/** opciones: [{ texto, sf, destructivo, alElegir }] */
export function MenuMas({ opciones, etiqueta, color }) {
  return (
    <Host matchContents>
      <Menu label={etiqueta} systemImage="ellipsis.circle"
        modifiers={[labelStyle('iconOnly'), ...(color ? [tint(String(color).toUpperCase())] : [])]}>
        {opciones.map((o) => (
          <Button key={o.texto} label={o.texto} systemImage={o.sf} role={o.destructivo ? 'destructive' : 'default'}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); o.alElegir(); }} />
        ))}
      </Menu>
    </Host>
  );
}

export function Capsula({ etiqueta, alTocar, color, prominente = true }) {
  return (
    <Host matchContents seedColor={color}>
      <Button onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar(); }}
        modifiers={[buttonStyle(prominente ? 'glassProminent' : 'glass'), controlSize('small'),
          ...(color && prominente ? [tint(String(color).toUpperCase())] : [])]}>
        <Text>{etiqueta}</Text>
      </Button>
    </Host>
  );
}
