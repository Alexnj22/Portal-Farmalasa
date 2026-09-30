// Una fecha con el selector del sistema (el compacto de iOS: se toca y abre el
// calendario). Entra y sale como texto AAAA-MM-DD, que es como la guarda el
// núcleo. `Fecha.js` es la versión de Android.
import { Host, DatePicker } from '@expo/ui/swift-ui';
import { datePickerStyle } from '@expo/ui/swift-ui/modifiers';

const aFecha = (s) => (s ? new Date(`${s}T12:00:00`) : new Date());
const aTexto = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Fecha({ valor, onCambiar, desde, hasta }) {
  return (
    <Host matchContents>
      <DatePicker selection={aFecha(valor)} displayedComponents={['date']}
        range={{ start: desde ? aFecha(desde) : undefined, end: hasta ? aFecha(hasta) : undefined }}
        modifiers={[datePickerStyle('compact')]}
        onDateChange={(d) => onCambiar(aTexto(d))} />
    </Host>
  );
}
