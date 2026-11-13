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
import { SEMILLA, usePaleta } from '../tema/material';

const PT_POR_LETRA = 8.2;
// Medido en el emulador (411 dp, 2026-11-12): con 34 caían a fichas pantallas
// en las que la barra sí cabía («Planilla · Practicantes · Externos», con la ✓
// sobre «Practicantes» incluida) y se veían distintas a sus vecinas. Con 24
// entra ésa, y siguen cayendo las que de verdad se parten en dos renglones
// («Documentos» y «Rechazadas» con cuatro opciones).
const RELLENO = 24;

export default function Segmentos({ opciones, activa, onCambiar, margen = 16 }) {
  const { width } = useWindowDimensions();
  const p = usePaleta();
  const parte = (width - margen * 2) / Math.max(1, opciones.length);
  const masLargo = Math.max(0, ...opciones.map((o) => String(o.label ?? '').length));
  if (opciones.length > 5 || masLargo * PT_POR_LETRA + RELLENO > parte) {
    return <Pestanas opciones={opciones} activa={activa} onCambiar={onCambiar} />;
  }
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: margen }} seedColor={SEMILLA}>
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        {opciones.map((o) => (
          <SegmentedButton key={o.id} selected={o.id === activa}
            onClick={() => { if (o.id !== activa) { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); } }}
            colors={{ activeContainerColor: p.secondaryContainer, activeContentColor: p.onSecondaryContainer, inactiveContentColor: p.onSurface,
              activeBorderColor: p.outline, inactiveBorderColor: p.outline, inactiveContainerColor: 'transparent' }}>
            <SegmentedButton.Label><Text>{o.label}</Text></SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
