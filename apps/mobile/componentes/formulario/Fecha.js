// Android: la fecha se escribe AAAA-MM-DD (el selector de Material llega en su
// fase). La de iPhone usa el del sistema (`Fecha.ios.js`).
import { Campo } from './Piezas';

export default function Fecha({ valor, onCambiar }) {
  const alEscribir = (t) => {
    const d = t.replace(/\D/g, '').slice(0, 8);
    onCambiar([d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('-'));
  };
  return <Campo multiline={false} value={valor ?? ''} onChangeText={alEscribir} placeholder="AAAA-MM-DD" keyboardType="number-pad" style={{ minWidth: 130 }} />;
}
