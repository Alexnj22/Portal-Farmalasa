// Un mes con flechas para ir al anterior y al siguiente — el `PeriodStepper`
// del portal en su versión de teléfono. No deja pasar del mes en curso.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { correrMes, mesSV, NOMBRES_DE_MES } from '@nucleo/utils/fecha';
import { colorSistema } from './Formulario';
import Vidrio from './Vidrio';
import { MARCA } from './inicio/marca';

export const nombreDelMes = (mes) => { const [a, m] = String(mes).split('-'); return `${NOMBRES_DE_MES[Number(m) - 1]} ${a}`; };

export default function PasoDeMes({ mes, onCambiar }) {
  const puedeAvanzar = mes < mesSV();
  const ir = (n) => { Haptics.selectionAsync().catch(() => {}); onCambiar(correrMes(mes, n)); };
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => ir(-1)} hitSlop={8} accessibilityLabel="Mes anterior"
            style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 24 }}>‹</Text>
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{nombreDelMes(mes)}</Text>
          <Pressable disabled={!puedeAvanzar} onPress={() => ir(1)} hitSlop={8} accessibilityLabel="Mes siguiente"
            style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: !puedeAvanzar ? 0.3 : pressed ? 0.5 : 1 })}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 24 }}>›</Text>
          </Pressable>
        </View>
      </Vidrio>
    </View>
  );
}
