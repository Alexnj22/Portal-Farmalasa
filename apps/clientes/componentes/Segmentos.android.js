// Android (2026-10-13): el botón segmentado de Material 3
// (SingleChoiceSegmentedButtonRow de Compose), el control nativo para elegir
// uno entre pocos — el par del segmentado de iOS (`Segmentos.ios.js`). Misma
// pieza que la app del personal (apps/mobile/componentes/Segmentos.js).
//
// Reparte el ancho en partes iguales: cuando el rótulo más largo no cabe en su
// parte (el ✓ de la elegida ocupa lugar), o son más de cinco, van las
// píldoras de React Native (`SegmentosPildoras.js`), que se leen enteras.
import { useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import SegmentosPildoras from './SegmentosPildoras';
import { colorSistema } from './sistema';
import { suave, useTema } from '../tema/tema';

const DP_POR_LETRA = 8.2;
const RELLENO = 34;

export default function Segmentos({ opciones, valor, alCambiar }) {
  const t = useTema();
  const { width } = useWindowDimensions();
  const parte = (width - 32) / Math.max(1, opciones.length);
  const masLargo = Math.max(0, ...opciones.map((o) => String(o.rotulo ?? '').length));
  if (opciones.length > 5 || masLargo * DP_POR_LETRA + RELLENO > parte) {
    return <SegmentosPildoras opciones={opciones} valor={valor} alCambiar={alCambiar} />;
  }
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 16 }}>
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        {opciones.map((o) => (
          <SegmentedButton key={o.valor} selected={o.valor === valor}
            onClick={() => { if (o.valor !== valor) { Haptics.selectionAsync().catch(() => {}); alCambiar(o.valor); } }}
            colors={{
              activeContainerColor: suave(t.color.magenta, t.oscuro ? 0.38 : 0.16),
              activeContentColor: colorSistema.texto, inactiveContentColor: colorSistema.texto,
              activeBorderColor: colorSistema.contorno, inactiveBorderColor: colorSistema.contorno,
              inactiveContainerColor: 'transparent',
            }}>
            <SegmentedButton.Label><Text>{o.rotulo}</Text></SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
