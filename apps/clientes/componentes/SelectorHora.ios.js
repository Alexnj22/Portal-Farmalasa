// La hora de una toma con el selector del sistema (SwiftUI DatePicker,
// 2026-10-13), el mismo de la fecha de nacimiento (FechaNacimiento.ios.js).
// Con los botones de ± una hora y ± 15 minutos, llegar a las 8:30 desde las
// 21:00 eran ocho toques. El valor sigue siendo «HH:MM», como lo guarda
// lib/tomas.js. Fuera de iPhone no hay selector: TomasHoja deja los botones.
import { View } from 'react-native';
import { DatePicker, Host } from '@expo/ui/swift-ui';
import * as Haptics from 'expo-haptics';

export const HORA_NATIVA = true;

const dos = (n) => String(n).padStart(2, '0');
const aFecha = (h) => {
  const [hh, mm] = String(h ?? '08:00').split(':').map(Number);
  const d = new Date();
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
};

export default function SelectorHora({ valor, titulo, alCambiar }) {
  return (
    <View style={{ minHeight: 44, justifyContent: 'center' }}>
      <Host matchContents>
        <DatePicker title={titulo} selection={aFecha(valor)} displayedComponents={['hourAndMinute']}
          onDateChange={(d) => {
            const nueva = `${dos(d.getHours())}:${dos(d.getMinutes())}`;
            if (nueva !== valor) { Haptics.selectionAsync().catch(() => {}); alCambiar(nueva); }
          }} />
      </Host>
    </View>
  );
}
