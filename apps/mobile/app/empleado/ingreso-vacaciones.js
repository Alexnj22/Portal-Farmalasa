// Ingreso en vacaciones, NATIVO — el «Ingreso en Vacaciones» de la ficha del
// portal (`FormVacationRecall`): alguien que está de vacaciones viene a
// trabajar un día. Se elige la fecha (dentro del período), el turno y el
// motivo; las horas de ese día quedan como horas DEBIDAS a su favor. Se
// guarda con `vacationRecallEmployee`, la misma del portal; las reglas, en el
// núcleo (`reingresoYRecontratacion`).
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ingresoCompleto, ingresoFueraDelPeriodo, vacacionEnCurso } from '@nucleo/utils/reingresoYRecontratacion';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';

const larga = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export default function IngresoEnVacaciones() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const turnos = useStaffStore((s) => s.shifts);
  const registrar = useStaffStore((s) => s.vacationRecallEmployee);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const [f, setF] = useState({ recall_date: hoySV(), recall_shift_id: '', recall_reason: '' });
  const [enviando, setEnviando] = useState(false);
  if (!emp) return <Aviso tono="freno" texto="No se encontró a esta persona." />;

  const vac = vacacionEnCurso(emp, hoySV());
  const inicio = vac?.date; const fin = vac?.metadata?.endDate;
  const fuera = ingresoFueraDelPeriodo(f.recall_date, inicio, fin);

  const guardar = () => Alert.alert('¿Autorizar el ingreso?', `${shortEmployeeName(emp)} trabaja el ${larga(f.recall_date)}. Esas horas quedan como debidas a su favor.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Autorizar', onPress: async () => {
      setEnviando(true); trabajando('Registrando…');
      try {
        const r = await registrar(emp.id, { date: f.recall_date, shift_id: f.recall_shift_id, reason: f.recall_reason, approved_by: user?.id || null });
        listo('Ingreso autorizado', `${shortEmployeeName(emp)} — ${r?.hoursWorked ?? '?'} h trabajadas. Total debidas: ${r?.newOwed ?? '?'} h`);
        volver(`/empleado/${emp.id}`);
      } catch (e) { fallo('No se registró', mensajeAmigable(e, 'Error al registrar el ingreso.')); }
      finally { setEnviando(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ingreso en vacaciones', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
          <Aviso tono="cuidado" texto="Esta persona está de vacaciones. Al autorizar su ingreso, las horas trabajadas quedan registradas como horas debidas a su favor." />
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{shortEmployeeName(emp)}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Vacaciones: ${larga(inicio)} → ${larga(fin)}`}</Text>
          <Seccion titulo="Fecha de ingreso">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Trabaja el</Text>
              <Fecha valor={f.recall_date} desde={inicio} hasta={fin} onCambiar={(v) => setF((p) => ({ ...p, recall_date: v }))} />
            </View>
            {fuera ? <Aviso tono="cuidado" texto={`La fecha debe estar dentro del período de vacaciones (${larga(inicio)} – ${larga(fin)}).`} /> : null}
          </Seccion>
          <Seccion titulo="Turno a asignar">
            <Opciones valor={f.recall_shift_id} onCambiar={(v) => setF((p) => ({ ...p, recall_shift_id: v }))}
              opciones={(turnos || []).map((t) => ({ id: String(t.id), label: t.name, detalle: `${hora12(t.start)} – ${hora12(t.end)}` }))} />
          </Seccion>
          <Seccion titulo="Motivo">
            <Campo value={f.recall_reason} onChangeText={(t) => setF((p) => ({ ...p, recall_reason: t }))} style={{ minHeight: 80 }}
              placeholder="Ej.: urgencia operativa, cobertura de sucursal, evento especial…" />
          </Seccion>
          <BotonGrande texto={enviando ? 'Registrando…' : 'Autorizar el ingreso'} color={MARCA.ambar} deshabilitado={!ingresoCompleto(f) || enviando} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
