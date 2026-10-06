// El control segmentado del sistema (el de «Pendientes · Aprobadas ·
// Rechazadas»): en iPhone es el de SwiftUI, con su vidrio y su animación.
// En Android, `Segmentos.js` cae a las píldoras de la app.
//
// El del sistema reparte el ancho en partes IGUALES y corta lo que no cabe
// («Haciend…», «Anulada…»). Cuando el rótulo más largo no entra en su parte,
// se usan las píldoras que se desplazan de lado (`Pestanas`): todas se leen
// enteras. La cuenta es aproximada a propósito (≈8.5 pt por letra a 15 pt):
// mejor pasar a píldoras un poco antes que cortar una palabra.
import { useWindowDimensions } from 'react-native';
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import Pestanas from './inicio/Pestanas';

const PT_POR_LETRA = 8.5;
const RELLENO = 18;

export default function Segmentos({ opciones, activa, onCambiar, margen = 16 }) {
  const { width } = useWindowDimensions();
  const parte = (width - margen * 2) / Math.max(1, opciones.length);
  const masLargo = Math.max(0, ...opciones.map((o) => String(o.label ?? '').length));
  if (masLargo * PT_POR_LETRA + RELLENO > parte) {
    return <Pestanas opciones={opciones} activa={activa} onCambiar={onCambiar} />;
  }
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: margen }}>
      <Picker selection={activa} onSelectionChange={onCambiar} modifiers={[pickerStyle('segmented')]}>
        {opciones.map((o) => <Text key={o.id} modifiers={[tag(o.id)]}>{o.label}</Text>)}
      </Picker>
    </Host>
  );
}
