// El control segmentado del sistema (SwiftUI), igual que en la app del personal.
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

export default function Segmentos({ opciones, valor, alCambiar }) {
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 16 }}>
      <Picker selection={valor} onSelectionChange={alCambiar} modifiers={[pickerStyle('segmented')]}>
        {opciones.map((o) => <Text key={o.valor} modifiers={[tag(o.valor)]}>{o.rotulo}</Text>)}
      </Picker>
    </Host>
  );
}
