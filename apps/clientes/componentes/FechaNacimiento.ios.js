// La fecha de nacimiento con el selector del sistema (SwiftUI DatePicker,
// 2026-10-07): en iPhone escribir «DD/MM/AAAA» con el teclado numérico era
// incómodo y daba fechas imposibles. El valor sigue siendo el texto DD/MM/AAAA
// que espera el registro, así que el resto del formulario no cambia.
import { Pressable, Text, View } from 'react-native';
import { DatePicker, Host } from '@expo/ui/swift-ui';
import * as Haptics from 'expo-haptics';
import { colorSistema } from './sistema';

const dos = (n) => String(n).padStart(2, '0');
const aTexto = (d) => `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
const aFecha = (t) => {
  const m = String(t ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : null;
};

export default function FechaNacimiento({ valor, alCambiar }) {
  const fecha = aFecha(valor);
  if (!fecha) {
    return (
      <Pressable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); alCambiar(aTexto(new Date(1990, 0, 1, 12))); }}
        style={{ minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 17, color: colorSistema.placeholder }}>Fecha de nacimiento</Text>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto2 }}>Agregar</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ minHeight: 52, paddingHorizontal: 16, justifyContent: 'center' }}>
      <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
        <DatePicker title="Nacimiento" selection={fecha} displayedComponents={['date']}
          range={{ start: new Date(1900, 0, 1), end: new Date() }}
          onDateChange={(d) => alCambiar(aTexto(d))} />
      </Host>
    </View>
  );
}
