// El día que se está mirando —el `FiltroDia` del portal—: flechas para correrlo
// y el calendario del sistema en el centro. No pasa de hoy.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import Fecha from '../../formulario/Fecha';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';

function Flecha({ texto, onPress, deshabilitado, etiqueta }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado}
      accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '300' }}>{texto}</Text>
    </Pressable>
  );
}

export default function DiaElegido({ fecha, onCambiar }) {
  const hoy = hoySV();
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 }}>
          <Flecha texto="‹" etiqueta="Día anterior" onPress={() => onCambiar(sumarDias(fecha, -1))} />
          <View style={{ alignItems: 'center', gap: 2, paddingVertical: 6 }}>
            <Fecha valor={fecha} hasta={hoy} onCambiar={(d) => onCambiar(d > hoy ? hoy : d)} />
            {fecha === hoy ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Hoy</Text> : null}
          </View>
          <Flecha texto="›" etiqueta="Día siguiente" deshabilitado={fecha >= hoy} onPress={() => onCambiar(sumarDias(fecha, 1))} />
        </View>
      </Vidrio>
    </View>
  );
}
