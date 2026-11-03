// Una fecha del tratamiento (cuándo empieza, hasta cuándo) con el selector del
// sistema (SwiftUI DatePicker, 2026-11-03), el mismo de SelectorHora y de la
// fecha de nacimiento. El valor es la fecha 'AAAA-MM-DD' en la hora del
// teléfono, como la guarda lib/tomas.js. Fuera de iPhone, TomasHoja deja los
// botones de ± un día y ± una semana.
import { View } from 'react-native';
import { DatePicker, Host } from '@expo/ui/swift-ui';
import * as Haptics from 'expo-haptics';

export const FECHA_NATIVA = true;

const dos = (n) => String(n).padStart(2, '0');
const aIso = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const aFecha = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d, 12); };

export default function SelectorFecha({ valor, titulo, desde, hasta, alCambiar }) {
  return (
    <View style={{ minHeight: 44, justifyContent: 'center' }}>
      <Host matchContents>
        <DatePicker title={titulo} selection={aFecha(valor)} displayedComponents={['date']}
          range={{ start: aFecha(desde), end: aFecha(hasta) }}
          onDateChange={(d) => {
            const nueva = aIso(d);
            if (nueva !== valor) { Haptics.selectionAsync().catch(() => {}); alCambiar(nueva); }
          }} />
      </Host>
    </View>
  );
}
