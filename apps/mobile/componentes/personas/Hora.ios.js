// Una hora en iPhone: botón con el valor (en 12 horas) y la rueda del sistema
// en una hoja (ver formulario/SelectorEnHoja.ios.js: el compacto de SwiftUI en
// el renglón no sigue a su lugar al desplazar). Entra y sale como texto «HH:MM»
// de 24 horas, que es como la guarda el horario. `Hora.js` es la de Android.
import { hora12 } from '@nucleo/utils/hora';
import SelectorEnHoja from '../formulario/SelectorEnHoja';

const aFecha = (h) => {
  const [hh, mm] = String(h || '08:00').split(':').map(Number);
  return new Date(2000, 0, 1, hh || 0, mm || 0, 0);
};
const aTexto = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function Hora({ valor, onCambiar }) {
  const d = aFecha(valor);
  return (
    <SelectorEnHoja texto={hora12(aTexto(d))} fecha={d} componentes={['hourAndMinute']} estilo="wheel"
      onElegir={(x) => onCambiar(aTexto(x))} />
  );
}
