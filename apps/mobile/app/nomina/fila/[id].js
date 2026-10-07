// Editar la fila de una persona en la planilla, NATIVO — `FormEditPayrollEntry`
// del portal. Días trabajados, horas (nocturnas y extra), ingresos y
// descuentos, con la vista previa del líquido calculada por la MISMA función
// que guarda (`calcPayrollEntry`). El motivo es obligatorio y queda en el
// historial de la fila (`edit_history`), como en el portal.
//
// Banco de horas extra: si la persona tiene horas acumuladas, se reparten en
// «pagar» (se suman a las extra de esta quincena) y «compensar» (tiempo
// libre); al guardar se descuentan del banco con `redeemOvertimeBank`, igual
// que el portal. El reparto no puede pasar del saldo.
//
// Lo escrito se guarda solo como borrador (por fila) hasta que se guarda.
import { volver } from '../../componentes/volver';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { calcPayrollEntry } from '@nucleo/store/slices/payrollSlice';
import { fetchOvertimeBankRows } from '@nucleo/data/payroll';
import { CAMPOS_EDITABLES_DE_PLANILLA, saldoDeBancoDeHoras } from '@nucleo/utils/planilla';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../../componentes/formulario/Piezas';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo } from '../../../componentes/Progreso';

const r2 = (n) => parseFloat((Number(n) || 0).toFixed(2));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const GRUPOS = [['horas', 'Horas adicionales'], ['ingresos', 'Otros ingresos'], ['descuentos', 'Descuentos']];

function FilaNumero({ rotulo, valor, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
      <Campo multiline={false} keyboardType="decimal-pad" value={String(valor ?? '')} onChangeText={onCambiar}
        style={{ width: 96, textAlign: 'right', fontVariant: ['tabular-nums'] }} />
    </View>
  );
}

export default function EditarFila() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const entradas = useStaffStore((s) => s.payrollEntries);
  const empleados = useStaffStore((s) => s.employees);
  const actualizar = useStaffStore((s) => s.updatePayrollEntry);
  const canjear = useStaffStore((s) => s.redeemOvertimeBank);
  const fila = useMemo(() => (entradas || []).find((e) => String(e.id) === String(id)), [entradas, id]);
  // El sueldo de la ficha VIVA: la copia pegada a la fila puede no traerlo.
  const ficha = useMemo(() => (empleados || []).find((e) => String(e.id) === String(fila?.employee_id)), [empleados, fila?.employee_id]);
  const emp = useMemo(() => ({ ...(fila?.employee || {}), ...(ficha || {}) }), [fila, ficha]);
  const clave = `planilla_${id}`;

  const inicial = () => {
    const b = loadDraft(clave);
    if (b) return b;
    const f = { days_worked: String(fila?.days_worked ?? 15), viaticos_detail: fila?.viaticos_detail || '', motivo: '', dPay: '', dComp: '', nPay: '', nComp: '' };
    for (const c of CAMPOS_EDITABLES_DE_PLANILLA) f[c.key] = String(fila?.[c.key] ?? 0);
    return f;
  };
  const [f, setF] = useState(inicial);
  const [banco, setBanco] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (fila) saveDraft(clave, f); }, [f, clave, fila]);
  useEffect(() => {
    if (!fila?.employee_id) return undefined;
    let vivo = true;
    fetchOvertimeBankRows(fila.employee_id).then(({ data }) => { if (vivo) setBanco(saldoDeBancoDeHoras(data)); });
    return () => { vivo = false; };
  }, [fila?.employee_id]);
  if (!fila) return <Aviso tono="freno" texto="No se encontró la fila de la planilla." />;

  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const dPay = num(f.dPay), dComp = num(f.dComp), nPay = num(f.nPay), nComp = num(f.nComp);
  const dError = r2(dPay + dComp) > (banco?.diurnal || 0) || dPay < 0 || dComp < 0;
  const nError = r2(nPay + nComp) > (banco?.nocturnal || 0) || nPay < 0 || nComp < 0;
  const tieneBanco = banco && (banco.diurnal > 0 || banco.nocturnal > 0);

  // Lo que se guarda: los campos escritos, más las horas del banco que se
  // pagan sumadas a las extra de la quincena (como «Aplicar distribución»).
  const datos = {};
  for (const c of CAMPOS_EDITABLES_DE_PLANILLA) datos[c.key] = num(f[c.key]);
  datos.extra_hours_diurnal = r2(datos.extra_hours_diurnal + dPay);
  datos.extra_hours_nocturnal = r2(datos.extra_hours_nocturnal + nPay);
  datos.days_worked = num(f.days_worked);
  datos.viaticos_detail = f.viaticos_detail;
  const vista = calcPayrollEntry(emp, datos.days_worked, datos);
  const valido = f.motivo.trim().length >= 3 && datos.days_worked >= 0 && datos.days_worked <= 16 && !dError && !nError;

  const guardar = () => Alert.alert('Guardar la fila',
    `${shortEmployeeName(emp)}: el líquido pasa de ${formatMoney(fila.net_pay)} a ${formatMoney(vista.net_pay)}. El motivo queda en el historial de la fila.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true);
        try {
          const ok = await actualizar(fila.id, datos, user?.name || user?.email || 'Admin', f.motivo.trim());
          if (!ok) throw new Error('No se pudo guardar la fila.');
          const nota = f.motivo.trim();
          const canjes = [[dPay, 'PAID', 'DIURNAL'], [dComp, 'TIME_OFF', 'DIURNAL'], [nPay, 'PAID', 'NOCTURNAL'], [nComp, 'TIME_OFF', 'NOCTURNAL']];
          for (const [horas, tipo, sub] of canjes) {
            if (horas > 0) await canjear(fila.employee_id, horas, tipo, sub, fila.period_id, nota, user?.id);
          }
          clearDraft(clave);
          listo('Fila guardada', `${shortEmployeeName(emp)} · ${formatMoney(vista.net_pay)}`);
          volver('/nomina');
        } catch (e) {
          fallo('No se pudo guardar', e?.message || 'Intenta de nuevo.');
        } finally { setGuardando(false); }
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Editar fila', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <View style={{ marginHorizontal: 4, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{shortEmployeeName(emp)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {emp.base_salary == null ? 'Salario diario: —' : `Salario diario: ${formatMoney(r2(emp.base_salary / 30))}`}
            </Text>
          </View>

          <Seccion titulo="Días trabajados" pie="Entre 0 y 16.">
            <FilaNumero rotulo="Días" valor={f.days_worked} onCambiar={cambiar('days_worked')} />
          </Seccion>

          {tieneBanco ? (
            <Seccion titulo="Banco de horas extra" pie="Pagar suma las horas a las extra de esta quincena; compensar las da como tiempo libre. Se descuentan del banco al guardar.">
              {banco.diurnal > 0 ? (
                <>
                  <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>{`Diurnas en banco: ${banco.diurnal} h`}</Text>
                  <FilaNumero rotulo="Pagar" valor={f.dPay} onCambiar={cambiar('dPay')} />
                  <FilaNumero rotulo="Compensar" valor={f.dComp} onCambiar={cambiar('dComp')} />
                  {dError ? <Aviso tono="freno" texto="Excede el saldo diurno." /> : null}
                </>
              ) : null}
              {banco.nocturnal > 0 ? (
                <>
                  <Text style={{ color: MARCA.violetaClaro, fontSize: 14, fontWeight: '700' }}>{`Nocturnas en banco: ${banco.nocturnal} h`}</Text>
                  <FilaNumero rotulo="Pagar" valor={f.nPay} onCambiar={cambiar('nPay')} />
                  <FilaNumero rotulo="Compensar" valor={f.nComp} onCambiar={cambiar('nComp')} />
                  {nError ? <Aviso tono="freno" texto="Excede el saldo nocturno." /> : null}
                </>
              ) : null}
            </Seccion>
          ) : null}

          {GRUPOS.map(([g, titulo]) => (
            <Seccion key={g} titulo={titulo}>
              {CAMPOS_EDITABLES_DE_PLANILLA.filter((c) => c.grupo === g).map((c) => (
                <FilaNumero key={c.key} rotulo={c.label} valor={f[c.key]} onCambiar={cambiar(c.key)} />
              ))}
              {g === 'ingresos' ? <Campo value={f.viaticos_detail} onChangeText={cambiar('viaticos_detail')} placeholder="Concepto de los viáticos" /> : null}
            </Seccion>
          ))}

          <Seccion titulo="Así queda">
            <Dato primero rotulo="Subtotal A" valor={formatMoney(vista.subtotal_a)} />
            <Dato rotulo="Subtotal B" valor={formatMoney(vista.subtotal_b)} />
            <Dato rotulo="Descuentos" valor={formatMoney(vista.total_deductions)} />
            <Dato rotulo="Líquido" valor={formatMoney(vista.net_pay)} fuerte />
          </Seccion>

          <Seccion titulo="Motivo (obligatorio)">
            <Campo value={f.motivo} onChangeText={cambiar('motivo')} placeholder="Por qué se edita esta fila" style={{ minHeight: 72 }} />
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar la fila'} onPress={guardar} deshabilitado={!valido || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
