// Un grupo de filtros: elegir UNO entre pocos (2026-10-14). En Android es el
// «grupo de botones conectados» de Material 3 Expressive
// (GrupoDeBotones.android.js); en iPhone y la web, las píldoras de siempre
// (`Chip` de ui.js), que es lo que iOS usa para filtrar una lista.
//
// `opciones`: pares [valor, texto], los mismos arreglos que ya usaban las
// pantallas para sus chips (Facturas, Reservas).
import { View } from 'react-native';
import { Chip } from './ui';

export default function GrupoDeBotones({ opciones, valor, alCambiar }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {opciones.map(([k, texto]) => <Chip key={k} texto={texto} activo={valor === k} alTocar={() => alCambiar(k)} />)}
    </View>
  );
}
