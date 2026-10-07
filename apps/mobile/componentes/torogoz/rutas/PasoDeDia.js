// El día que se mira, con flechas para correrlo y el calendario del sistema en
// el centro — el `FiltroDia` del portal en su versión de teléfono.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { colorSistema } from '../../Formulario';
import Vidrio from '../../Vidrio';
import Fecha from '../../formulario/Fecha';

const PETROLEO = '#0f6e7d';

export default function PasoDeDia({ fecha, onCambiar, max = null }) {
  const ir = (n) => { Haptics.selectionAsync().catch(() => {}); onCambiar(sumarDias(fecha, n)); };
  const puedeAvanzar = !max || fecha < max;
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => ir(-1)} hitSlop={8} accessibilityLabel="Día anterior"
            style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ color: PETROLEO, fontSize: 24 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
            <Fecha valor={fecha} hasta={max ?? undefined} onCambiar={(d) => onCambiar(max && d > max ? max : d)} />
            {fecha !== hoySV() ? (
              <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(hoySV()); }} hitSlop={8} accessibilityRole="button">
                <Text style={{ color: PETROLEO, fontSize: 15, fontWeight: '700' }}>Hoy</Text>
              </Pressable>
            ) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Hoy</Text>}
          </View>
          <Pressable disabled={!puedeAvanzar} onPress={() => ir(1)} hitSlop={8} accessibilityLabel="Día siguiente"
            style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: !puedeAvanzar ? 0.3 : pressed ? 0.5 : 1 })}>
            <Text style={{ color: PETROLEO, fontSize: 24 }}>›</Text>
          </Pressable>
        </View>
      </Vidrio>
    </View>
  );
}
