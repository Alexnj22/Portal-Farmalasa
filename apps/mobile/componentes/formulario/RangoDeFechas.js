// Un período libre: «Desde» y «Hasta» con el selector de fecha del sistema
// (`Fecha`, compacto en iOS y Material en Android). Es el `PeriodPicker` del
// portal en su forma de teléfono — lo usan las pantallas que además ofrecen
// atajos (Hoy, 7 días…) en un segmentado y, con «Fechas», muestran esto.
// Entra y sale como texto AAAA-MM-DD; «hasta» nunca pasa de hoy.
import { Text, View } from 'react-native';
import { hoySV } from '@nucleo/utils/fecha';
import Fecha from './Fecha';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';

export default function RangoDeFechas({ desde, hasta, onCambiar, margen = 16 }) {
  return (
    <View style={{ marginHorizontal: margen }}>
      <Vidrio radio={18}>
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Desde</Text>
            <Fecha valor={desde} onCambiar={(v) => onCambiar({ desde: v, hasta: hasta < v ? v : hasta })} hasta={hasta || hoySV()} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Hasta</Text>
            <Fecha valor={hasta} onCambiar={(v) => onCambiar({ desde: desde > v ? v : desde, hasta: v })} desde={desde} hasta={hoySV()} />
          </View>
        </View>
      </Vidrio>
    </View>
  );
}
