// Android: el botón segmentado de Material 3 (SingleChoiceSegmentedButtonRow
// de Compose), el control nativo para elegir uno entre pocos — el par del
// segmentado de iOS (`Segmentos.ios.js`). Como allá, reparte el ancho en
// partes iguales: cuando el rótulo más largo no cabe en su parte, o son más de
// cinco, van las fichas que se desplazan de lado (`Pestanas`), que se leen
// enteras.
import { useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import Pestanas from './inicio/Pestanas';
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';

const PT_POR_LETRA = 8.2;
const RELLENO = 34; // el ✓ de la opción elegida ocupa lugar

export default function Segmentos({ opciones, activa, onCambiar, margen = 16 }) {
  const { width } = useWindowDimensions();
  const parte = (width - margen * 2) / Math.max(1, opciones.length);
  const masLargo = Math.max(0, ...opciones.map((o) => String(o.label ?? '').length));
  if (opciones.length > 5 || masLargo * PT_POR_LETRA + RELLENO > parte) {
    return <Pestanas opciones={opciones} activa={activa} onCambiar={onCambiar} />;
  }
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: margen }}>
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        {opciones.map((o) => (
          <SegmentedButton key={o.id} selected={o.id === activa}
            onClick={() => { if (o.id !== activa) { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); } }}
            colors={{ activeContainerColor: `${MARCA.azul}29`, activeContentColor: colorSistema.texto, inactiveContentColor: colorSistema.texto,
              activeBorderColor: colorSistema.texto2, inactiveBorderColor: colorSistema.texto2, inactiveContainerColor: 'transparent' }}>
            <SegmentedButton.Label><Text>{o.label}</Text></SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
