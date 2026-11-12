// Una fecha en iPhone: botón con el valor y el calendario del sistema en una
// hoja (ver SelectorEnHoja.ios.js: el compacto de SwiftUI en el renglón no
// sigue a su lugar al desplazar). Entra y sale como texto AAAA-MM-DD, que es
// como la guarda el núcleo. `Fecha.js` es la versión de Android.
import SelectorEnHoja from './SelectorEnHoja';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const aFecha = (s) => (s ? new Date(`${s}T12:00:00`) : new Date());
const aTexto = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Fecha({ valor, onCambiar, desde, hasta }) {
  const d = aFecha(valor);
  return (
    <SelectorEnHoja texto={`${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`} fecha={d}
      componentes={['date']} estilo="graphical"
      range={{ start: desde ? aFecha(desde) : undefined, end: hasta ? aFecha(hasta) : undefined }}
      onElegir={(x) => onCambiar(aTexto(x))} />
  );
}
