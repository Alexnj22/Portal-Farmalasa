// Las piezas de «Diferencias» que comparten la lista de días y la ficha del
// día: los rótulos de cada estado y de cada tramo del desglose, en los colores
// de la marca, y la barra del día. Las CUENTAS son del núcleo
// (`diferenciasDeCaja`); acá sólo se les pone nombre y color.
import { Text, View } from 'react-native';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

// Los rótulos del portal, en los colores de la marca.
export const ESTADO_DIF = {
  sin_resolver: ['Sin resolver', MARCA.rojo], por_confirmar: ['Falta confirmar el corte', MARCA.ambar],
  con_saldo: ['Por cobrar', MARCA.ambar], por_registrar: ['Por anotar', MARCA.azulClaro],
  acumulado: ['Acumulado', MARCA.azulClaro], resuelto: ['Resuelto', MARCA.verde],
};
export const TRAMOS_DIF = {
  falta: [['abonado', 'Abonado', MARCA.verde], ['explicado', 'Con causa', MARCA.azulClaro], ['porCobrar', 'Por cobrar', MARCA.ambar],
    ['porConfirmar', 'Por confirmar', MARCA.violeta], ['sinResolver', 'Sin resolver', MARCA.rojo]],
  sobra: [['explicado', 'Con causa', MARCA.azulClaro], ['acumulado', 'Acumulado', MARCA.ambar], ['porConfirmar', 'Por confirmar', MARCA.violeta]],
};
export const montoDelDia = (d, signo) => (signo === 'sobra' ? Number(d.sobrante || 0) : Math.abs(Number(d.faltante || 0)));

export function BarraDelDia({ desglose, signo }) {
  const tramos = TRAMOS_DIF[signo].filter(([k]) => desglose[k] > 0);
  if (!desglose.total) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: colorSistema.separador, gap: 1 }}>
        {tramos.map(([k, , c]) => <View key={k} style={{ width: `${(desglose[k] / desglose.total) * 100}%`, backgroundColor: c }} />)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 }}>
        {tramos.map(([k, rotulo, c]) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo} <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{formatMoney(desglose[k])}</Text></Text>
          </View>
        ))}
      </View>
    </View>
  );
}

