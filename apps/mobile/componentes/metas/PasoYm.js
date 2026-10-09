// El paso de mes de Metas: flechas a los lados y el mes en el medio; tocar
// el mes vuelve al actual. `min`/`max` en 'AAAA-MM' (la historia empieza en
// `YM_INICIO_HISTORIA` y el tablero deja ver el mes que viene).
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ymLabel, ymSumar } from '@nucleo/utils/metasUtils';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Tocable from '../Tocable';

export default function PasoYm({ ym, onCambiar, min, max, actual }) {
  const ir = (n) => { Haptics.selectionAsync().catch(() => {}); onCambiar(ymSumar(ym, n)); };
  const flecha = (texto, n, desactivada, etiqueta) => (
    <Tocable disabled={desactivada} onPress={() => ir(n)} hitSlop={8} accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: desactivada ? 0.3 : pressed ? 0.5 : 1 })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 26, fontWeight: '500' }}>{texto}</Text>
    </Tocable>
  );
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {flecha('‹', -1, ym <= min, 'Mes anterior')}
          <Tocable style={{ flex: 1, minHeight: 48, justifyContent: 'center' }} disabled={ym === actual}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(actual); }}>
            <Text style={{ textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{ymLabel(ym)}</Text>
            {ym !== actual ? <Text style={{ textAlign: 'center', color: MARCA.azulClaro, fontSize: 12 }}>Volver al mes actual</Text> : null}
          </Tocable>
          {flecha('›', 1, ym >= max, 'Mes siguiente')}
        </View>
      </Vidrio>
    </View>
  );
}
