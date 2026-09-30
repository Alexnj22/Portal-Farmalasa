// El control segmentado del sistema (el de «Pendientes · Aprobadas ·
// Rechazadas»): en iPhone es el de SwiftUI, con su vidrio y su animación.
// En Android, `Segmentos.js` cae a las píldoras de la app.
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

export default function Segmentos({ opciones, activa, onCambiar, margen = 16 }) {
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: margen }}>
      <Picker selection={activa} onSelectionChange={onCambiar} modifiers={[pickerStyle('segmented')]}>
        {opciones.map((o) => <Text key={o.id} modifiers={[tag(o.id)]}>{o.label}</Text>)}
      </Picker>
    </Host>
  );
}
