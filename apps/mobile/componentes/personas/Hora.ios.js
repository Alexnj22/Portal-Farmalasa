// Una hora con el selector del sistema (el compacto de iOS: se toca y abre la
// rueda). Entra y sale como texto «HH:MM» de 24 horas, que es como la guarda el
// horario. `Hora.js` es la versión de Android.
import { Host, DatePicker } from '@expo/ui/swift-ui';
import { datePickerStyle } from '@expo/ui/swift-ui/modifiers';

const aFecha = (h) => {
  const [hh, mm] = String(h || '08:00').split(':').map(Number);
  const d = new Date(2000, 0, 1, hh || 0, mm || 0, 0);
  return d;
};
const aTexto = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function Hora({ valor, onCambiar }) {
  return (
    <Host matchContents>
      <DatePicker selection={aFecha(valor)} displayedComponents={['hourAndMinute']}
        modifiers={[datePickerStyle('compact')]}
        onDateChange={(d) => onCambiar(aTexto(d))} />
    </Host>
  );
}
