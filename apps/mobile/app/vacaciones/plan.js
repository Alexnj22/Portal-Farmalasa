// Asignar o editar un plan de vacaciones, NATIVO — el formulario de
// `VacationPlanView`. Sin `?id` asigna uno nuevo: se elige a la persona (sólo
// personal en planilla, activa y sin plan en el año; las que no son elegibles
// salen apagadas con el motivo), se ve su elegibilidad
// (`elegibilidadDeVacaciones`, núcleo: el mismo aviso del portal) y su saldo
// del año, y se eligen las fechas — con hora si el primer o el último día es
// medio. Los días se cuentan con `diasDeVacacion`, el mismo del portal.
//
// Con `?id` edita el plan (fechas, horas, nota) y pide confirmación. Guarda
// con `createVacationPlan` / `updateVacationPlan`, las funciones del portal:
// ellas revisan la ventana del aniversario y los traslapes y avisan.
import { volver } from '../../componentes/volver';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { diasDeVacacion, diasUsadosPorPersona, elegibilidadDeVacaciones } from '@nucleo/utils/planDeVacaciones';
import { soloPersonalEnPlanilla } from '@nucleo/utils/tipoDeFicha';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Hora from '../../componentes/personas/Hora';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

const TONO = { ok: MARCA.verde, cuidado: MARCA.ambar, adelanto: MARCA.violetaClaro, no: MARCA.rojo };
const larga = (f) => (f ? fechaTexto(f, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const BORRADOR = 'vacaciones_plan_nuevo';

export default function PlanDeVacaciones() {
  const { id, anio: anioParam } = useLocalSearchParams();
  const { user } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const planes = useStaffStore((s) => s.vacationPlans);
  const crear = useStaffStore((s) => s.createVacationPlan);
  const actualizar = useStaffStore((s) => s.updateVacationPlan);
  const editando = useMemo(() => (id ? (planes || []).find((p) => String(p.id) === String(id)) : null), [planes, id]);
  const anio = Number(editando?.year || anioParam || hoySV().slice(0, 4));

  const [f, setF] = useState(() => {
    if (editando) return { empId: String(editando.employee_id), inicio: editando.start_date, fin: editando.end_date,
      horaInicio: editando.start_time ? editando.start_time.slice(0, 5) : '', horaFin: editando.end_time ? editando.end_time.slice(0, 5) : '', nota: editando.notes || '' };
    return loadDraft(BORRADOR) || { empId: '', inicio: '', fin: '', horaInicio: '', horaFin: '', nota: '' };
  });
  const [buscar, setBuscar] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (!editando) saveDraft(BORRADOR, f); }, [f, editando]);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const nombreSala = (bid) => (sucursales || []).find((b) => String(b.id) === String(bid))?.name || '—';
  const conPlan = useMemo(() => new Set((planes || []).filter((p) => p.year === anio && p.status !== 'CANCELLED').map((p) => String(p.employee_id))), [planes, anio]);
  const usados = useMemo(() => diasUsadosPorPersona((planes || []).filter((p) => p.year === anio), anio), [planes, anio]);
  // Las personas que se pueden elegir, como el selector del portal: primero las
  // elegibles por sala, después las que no (apagadas, con el motivo).
  const hoy = hoySV();
  const opciones = useMemo(() => soloPersonalEnPlanilla(empleados || [])
    .filter((e) => e.status === 'ACTIVO' || e.status === 'ACTIVE')
    .map((e) => {
      const el = elegibilidadDeVacaciones(e.hire_date, hoy);
      const motivo = conPlan.has(String(e.id)) ? `Ya tiene vacaciones en ${anio}`
        : !e.hire_date ? 'Sin fecha de ingreso' : !el?.isEligible ? `${el.monthsWorked} meses · falta${12 - el.monthsWorked === 1 ? '' : 'n'} ${12 - el.monthsWorked}` : null;
      return { e, motivo, sala: nombreSala(e.branch_id ?? e.branchId) };
    })
    .sort((a, b) => (a.motivo ? 1 : 0) - (b.motivo ? 1 : 0) || a.sala.localeCompare(b.sala) || String(a.e.name).localeCompare(String(b.e.name))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [empleados, conPlan, anio, hoy, sucursales]);
  const persona = useMemo(() => (empleados || []).find((e) => String(e.id) === String(f.empId)), [empleados, f.empId]);
  const eleg = !editando && persona ? elegibilidadDeVacaciones(persona.hire_date, hoy) : null;
  const saldo = persona ? 15 - (usados.get(String(persona.id)) || 0) : null;
  const dias = f.inicio && f.fin ? diasDeVacacion(f.inicio, f.fin, f.horaInicio, f.horaFin) : 0;
  const valido = f.empId && f.inicio && f.fin && f.fin >= f.inicio;

  const guardar = async () => {
    setGuardando(true);
    try {
      if (editando) {
        const ok = await actualizar(editando.id, { start_date: f.inicio, end_date: f.fin, start_time: f.horaInicio || null, end_time: f.horaFin || null, days: dias, notes: f.nota.trim() || null });
        if (!ok) throw new Error('No se pudo actualizar.');
        listo('Plan actualizado', shortEmployeeName(persona || {}));
      } else {
        await crear({ year: anio, employee_id: f.empId, branch_id: persona?.branch_id || persona?.branchId, start_date: f.inicio, end_date: f.fin,
          start_time: f.horaInicio || null, end_time: f.horaFin || null, days: dias, notes: f.nota.trim() || null, created_by: user?.id });
        clearDraft(BORRADOR);
        listo('Vacaciones asignadas', `${shortEmployeeName(persona || {})} · ${dias} días`);
      }
      volver('/vacaciones');
    } catch (e) {
      const m = e?.message || '';
      if (m.startsWith('WINDOW_ERROR:')) fallo('Fuera de ventana', m.replace('WINDOW_ERROR: ', ''));
      else if (m.startsWith('OVERLAP_ERROR:')) fallo('Se traslapa', m.replace('OVERLAP_ERROR: ', ''));
      else fallo('No se pudo guardar', m || 'Intenta de nuevo.');
    } finally { setGuardando(false); }
  };
  const confirmar = () => Alert.alert(editando ? 'Cambiar el plan' : 'Asignar vacaciones',
    `${shortEmployeeName(persona || {})}: ${larga(f.inicio)} – ${larga(f.fin)}, ${dias} día${dias === 1 ? '' : 's'}.`,
    [{ text: 'Cancelar', style: 'cancel' }, { text: editando ? 'Guardar' : 'Asignar', onPress: guardar }]);

  const filtradas = opciones.filter((o) => !buscar.trim() || tokenMatch(buscar.trim(), o.e.name, o.sala));

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: editando ? 'Editar vacaciones' : `Asignar vacaciones ${anio}`, headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {persona ? (
            <Pressable disabled={!!editando} onPress={() => cambiar('empId')('')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 4 }}>
              <Avatar empleado={persona} tamano={48} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{shortEmployeeName(persona)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[persona.role, nombreSala(persona.branch_id ?? persona.branchId)].filter(Boolean).join(' · ')}</Text>
              </View>
              {!editando ? <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text> : null}
            </Pressable>
          ) : (
            <Seccion titulo="¿A quién?">
              <Campo multiline={false} value={buscar} onChangeText={setBuscar} placeholder="Buscar por nombre o sala" />
              {filtradas.slice(0, 60).map(({ e, motivo, sala }, i) => (
                <Pressable key={e.id} disabled={!!motivo} onPress={() => { Haptics.selectionAsync().catch(() => {}); cambiar('empId')(String(e.id)); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, opacity: motivo ? 0.45 : pressed ? 0.7 : 1,
                    borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 })}>
                  <Avatar empleado={e} tamano={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{motivo ? `${motivo} · ${sala}` : `${e.role || 'Empleado'} · ${sala}`}</Text>
                  </View>
                </Pressable>
              ))}
            </Seccion>
          )}

          {eleg ? (
            <Seccion titulo={eleg.rotulo}>
              <Text style={{ color: TONO[eleg.tono], fontSize: 15, fontWeight: '700' }}>{eleg.rotulo}</Text>
              {eleg.isEligible ? (
                <>
                  <Dato primero rotulo="Antigüedad" valor={`${eleg.yearsWorked} años`} />
                  <Dato rotulo="Último aniversario" valor={larga(eleg.lastAnniversary)} />
                  <Dato rotulo="Ventana válida hasta" valor={larga(eleg.windowEnd)} />
                </>
              ) : (
                <>
                  <Dato primero rotulo="Antigüedad" valor={`${eleg.monthsWorked} meses`} />
                  <Dato rotulo="Próximo aniversario" valor={larga(eleg.nextAnniversary)} />
                </>
              )}
              {eleg.isEligible && saldo != null ? <Dato rotulo={`Saldo ${anio}`} valor={`${Math.max(0, saldo)} / 15 días`} fuerte /> : null}
            </Seccion>
          ) : null}

          {persona ? (
            <>
              <Seccion titulo="Fechas" pie={dias ? `${dias} día${dias === 1 ? '' : 's'} de vacaciones.` : null}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
                  <Fecha valor={f.inicio || hoy} onCambiar={(v) => setF((x) => ({ ...x, inicio: v, fin: x.fin && x.fin >= v ? x.fin : v }))} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
                  <Fecha valor={f.fin || f.inicio || hoy} desde={f.inicio || hoy} onCambiar={cambiar('fin')} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>El primer día empieza a una hora</Text>
                  <Switch value={!!f.horaInicio} onValueChange={(v) => cambiar('horaInicio')(v ? '13:00' : '')} />
                </View>
                {f.horaInicio ? <View style={{ alignItems: 'flex-end' }}><Hora valor={f.horaInicio} onCambiar={cambiar('horaInicio')} /></View> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>El último día termina a una hora</Text>
                  <Switch value={!!f.horaFin} onValueChange={(v) => cambiar('horaFin')(v ? '12:00' : '')} />
                </View>
                {f.horaFin ? <View style={{ alignItems: 'flex-end' }}><Hora valor={f.horaFin} onCambiar={cambiar('horaFin')} /></View> : null}
              </Seccion>
              <Seccion titulo="Nota (opcional)">
                <Campo value={f.nota} onChangeText={cambiar('nota')} placeholder="Comentario del plan" />
              </Seccion>
              {eleg && !eleg.isEligible && !eleg.isNearEligible ? <Aviso tono="cuidado" texto="Todavía no cumple el año: el sistema puede rechazar la asignación." /> : null}
              <BotonGrande texto={guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Asignar vacaciones'} onPress={confirmar} deshabilitado={!valido || guardando} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
