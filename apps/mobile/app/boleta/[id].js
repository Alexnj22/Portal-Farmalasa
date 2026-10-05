// La boleta de pago de una persona, NATIVO: lo que gana (salario ordinario,
// extras, nocturnidad, bonificaciones, viáticos…), lo que se le descuenta
// (ISSS, AFP, renta, anticipos, pedidos…) y el líquido, también en letras
// (`montoEnLetras`, el mismo texto de la boleta impresa).
import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { montoEnLetras } from '@nucleo/utils/planilla';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';

const INGRESOS = [
  ['Salario ordinario', 'ordinary_salary'], ['Horas extra diurnas', 'extra_hours_diurnal'], ['Horas extra nocturnas', 'extra_hours_nocturnal'],
  ['Nocturnidad ordinaria', 'night_hours_ordinary'], ['Nocturnidad extra', 'night_hours_extra'], ['Recargo de asueto', 'holiday_surcharge'],
  ['Bonificaciones', 'bonifications'], ['Prima de vacaciones', 'vacation_bonus'], ['Viáticos', 'viaticos'],
];
const DESCUENTOS = [
  ['ISSS', 'isss_deduction'], ['AFP', 'afp_deduction'], ['Renta', 'renta_deduction'], ['Anticipo de salario', 'salary_advance'],
  ['Pedidos', 'order_discount'], ['Otros descuentos', 'other_discounts'],
];

export default function Boleta() {
  const { id } = useLocalSearchParams();
  const e = useStaffStore((s) => (s.payrollEntries || []).find((x) => String(x.id) === String(id)));
  if (!e) return <Aviso tono="freno" texto="No se encontró la boleta." />;
  const filas = (lista) => lista.filter(([, k]) => Number(e[k])).map(([r, k], i) => <Dato key={k} primero={i === 0} rotulo={r} valor={formatMoney(e[k])} />);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Boleta', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Vidrio radio={24} tinte="rgba(18,183,106,0.12)">
          <View style={{ padding: 18, gap: 6, alignItems: 'center' }}>
            <Avatar empleado={e.employee ?? { name: '?' }} tamano={56} />
            <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{e.employee ? shortEmployeeName(e.employee) : 'Sin ficha'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${e.days_worked ?? '—'} días trabajados`}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', marginTop: 4 }}>{formatMoney(e.net_pay)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>{montoEnLetras(Number(e.net_pay || 0))}</Text>
          </View>
        </Vidrio>
        <Seccion titulo="Ingresos">{filas(INGRESOS)}<Dato rotulo="Subtotal" valor={formatMoney(e.subtotal_a)} fuerte /></Seccion>
        <Seccion titulo="Descuentos">{filas(DESCUENTOS)}<Dato rotulo="Total descuentos" valor={formatMoney(e.total_deductions)} fuerte /></Seccion>
        {e.viaticos_detail ? <Seccion titulo="Detalle de viáticos"><Text style={{ color: colorSistema.texto, fontSize: 14 }}>{String(e.viaticos_detail)}</Text></Seccion> : null}
      </ScrollView>
    </>
  );
}
