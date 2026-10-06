// Mi perfil, NATIVO — la vista «Mi perfil» del portal (`EmployeeProfileView`):
// quién soy en la empresa (cargo, sala, cuánto llevo), mis datos y contactos,
// mi horario de esta semana (con la ausencia del día si la hay), mis próximas
// vacaciones y todo mi plan, mi expediente en línea, y mi historial con buscar,
// tipo y desde/hasta (`filtrarHistorial`, la misma regla del portal). Las cuentas son del núcleo
// (`miPerfil`): las mismas que hace el portal.
//
// Editar el contacto (celular y contacto de emergencia) sólo se ofrece a quien
// puede editar fichas, igual que en el portal: ofrecérselo a quien la base va a
// rechazar no es un permiso de más, es una promesa que no se cumple.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchOwnEventsFull, fetchOwnPendingRequestsCount, fetchOwnVacationPlansActive } from '@nucleo/data/employeeSelfService';
import { ausenciaDelDia, cumpleEn, historialDePerfil, proximasVacaciones, semanaDelPerfil, tiempoEnLaEmpresa } from '@nucleo/utils/miPerfil';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { ExpedienteEnLinea, FilaConIcono, Historial, PlanDeVacaciones } from '../componentes/perfil/Piezas';

const fecha = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const AUSENCIA = { VACATION: 'Vac', DISABILITY: 'Incap.', PERMIT: 'Perm.' };
// «7:00 a. m.» → «7a», como lo abrevia el portal en la semana.
const horaCorta = (h) => (hora12(h) || '').replace(':00', '').replace(/\s?a\.\s?m\./, 'a').replace(/\s?p\.\s?m\./, 'p');

function EditarContacto({ emp, abierto, onCerrar }) {
  const updateEmployee = useStaffStore((s) => s.updateEmployee);
  const [form, setForm] = useState({ phone: '', emergency_contact_name: '', emergency_contact_phone: '' });
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (abierto) setForm({ phone: emp?.phone || '', emergency_contact_name: emp?.emergency_contact_name || '', emergency_contact_phone: emp?.emergency_contact_phone || '' });
  }, [abierto, emp]);
  const guardar = async () => {
    setGuardando(true); trabajando('Guardando…');
    try {
      await updateEmployee(emp.id, form);
      listo('Perfil actualizado', 'Tus contactos quedaron guardados.');
      onCerrar();
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Editar contacto</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          <Seccion titulo="Celular">
            <Campo multiline={false} value={form.phone} keyboardType="phone-pad" placeholder="0000-0000" onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} />
          </Seccion>
          <Seccion titulo="Contacto de emergencia">
            <Campo multiline={false} value={form.emergency_contact_name} placeholder="Nombre y apellido" autoCapitalize="words" onChangeText={(v) => setForm((f) => ({ ...f, emergency_contact_name: v }))} />
            <Campo multiline={false} value={form.emergency_contact_phone} keyboardType="phone-pad" placeholder="Teléfono" onChangeText={(v) => setForm((f) => ({ ...f, emergency_contact_phone: v }))} />
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.verde} deshabilitado={guardando} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

export default function MiPerfil() {
  const { user, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const turnos = useStaffStore((s) => s.shifts);
  const emp = (empleados || []).find((e) => String(e.id) === String(user?.id)) || user;
  const sala = (sucursales || []).find((b) => String(b.id) === String(emp?.branchId || emp?.branch_id));
  const puedeEditar = hasPermission('staff_list', 'can_edit');
  const [eventos, setEventos] = useState([]);
  const [activas, setActivas] = useState(0);
  const [planes, setPlanes] = useState([]);
  const [editando, setEditando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!user?.id) return;
    const [{ data: ev }, { count }, { data: vp }] = await Promise.all([
      fetchOwnEventsFull(user.id), fetchOwnPendingRequestsCount(user.id), fetchOwnVacationPlansActive(user.id),
    ]);
    setEventos(ev || []); setActivas(count || 0); setPlanes(vp || []);
  }, [user?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const hoy = hoySV();
  const historial = useMemo(() => historialDePerfil(eventos, emp?.hire_date || emp?.hireDate, sala?.name), [eventos, emp, sala]);
  const semana = useMemo(() => semanaDelPerfil(emp?.weeklySchedule, turnos || [], hoy), [emp, turnos, hoy]);
  const vacaciones = proximasVacaciones(planes, hoy);
  const cumple = cumpleEn(emp?.birth_date, hoy);
  if (!emp) return null;
  const cargos = [emp.role, emp.secondary_role].filter((r) => r && isNaN(Number(r)));

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Mi perfil' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Vidrio radio={26}>
          <View style={{ padding: 20, alignItems: 'center', gap: 8 }}>
            <Avatar empleado={emp} tamano={88} />
            <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{shortEmployeeName(emp)}</Text>
            {cargos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{cargos.join(' · ')}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {sala ? <Pildora texto={sala.name} color={MARCA.azulClaro} /> : null}
              {cumple ? <Pildora texto={`Cumpleaños ${cumple}`} color={MARCA.violeta} /> : null}
            </View>
          </View>
        </Vidrio>

        <View style={{ marginHorizontal: -16 }}>
          <FilaDeKpis>
            <Kpi icono="Medal" rotulo="En la empresa" valor={tiempoEnLaEmpresa(emp.hire_date || emp.hireDate, hoy)} color={MARCA.azul}
              apoyo={emp.hire_date ? `desde ${fecha(emp.hire_date)}` : null} />
            <Kpi icono="ClipboardList" rotulo="Solicitudes" valor={String(activas)} color={activas ? MARCA.ambar : MARCA.verde}
              apoyo={activas ? 'en curso' : 'ninguna en curso'} onPress={() => router.push('/solicitudes')} />
          </FilaDeKpis>
        </View>

        {vacaciones ? (
          <Vidrio radio={20} tinte="rgba(18,183,106,0.14)">
            <View style={{ padding: 14, gap: 4 }}>
              <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>Próximas vacaciones</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{`${fecha(vacaciones.start_date)} – ${fecha(vacaciones.end_date)}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{vacaciones.status === 'CONFIRMED' ? 'Confirmadas' : 'Planificadas'}</Text>
            </View>
          </Vidrio>
        ) : null}

        {semana.length ? (
          <Seccion titulo="Mi horario de esta semana">
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {semana.map((d) => {
                const esHoy = d.fecha === hoy;
                const aus = ausenciaDelDia(eventos, d.fecha);
                return (
                  <View key={d.id} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 14,
                    backgroundColor: esHoy ? MARCA.azul : aus ? 'rgba(18,183,106,0.18)' : d.turno ? 'rgba(127,127,127,0.14)' : 'transparent' }}>
                    <Text style={{ color: esHoy ? '#fff' : colorSistema.texto2, fontSize: 11, fontWeight: '700' }}>{d.short}</Text>
                    <Text style={{ color: esHoy ? '#fff' : colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{Number(d.fecha.slice(8))}</Text>
                    {/* Entrada y salida en dos renglones de 11 pt: en uno solo, a
                        9 pt y cortado, no se leía la hora. */}
                    <Text style={{ color: esHoy ? '#fff' : aus ? MARCA.verde : colorSistema.texto2, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>
                      {aus ? AUSENCIA[aus.type] : d.turno ? `${horaCorta(d.turno.start)}\n${horaCorta(d.turno.end)}` : 'Libre'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Seccion>
        ) : null}

        <PlanDeVacaciones planes={planes} hoy={hoy} />

        <Seccion titulo="Mis datos">
          <FilaConIcono primero icono="Cake" color={MARCA.violetaClaro} rotulo="Nacimiento" valor={fecha(emp.birth_date)} extra={cumple ? `Cumpleaños ${cumple}` : null} />
          <FilaConIcono icono="IdCard" rotulo="Documento (DUI)" valor={emp.dui || '—'} />
          <FilaConIcono icono="Stethoscope" color={MARCA.rojo} rotulo="Tipo de sangre" valor={emp.blood_type || '—'} />
          {emp.contract_type ? <FilaConIcono icono="FileText" rotulo="Tipo de contrato" valor={emp.contract_type} /> : null}
          {emp.weekly_hours ? <FilaConIcono icono="Clock" rotulo="Horas por semana" valor={String(emp.weekly_hours)} /> : null}
        </Seccion>

        <Seccion titulo="Contacto">
          <FilaConIcono primero icono="Home" rotulo="Sucursal" valor={sala?.name || '—'} />
          <FilaConIcono icono="Phone" color={MARCA.verde} rotulo="Celular" valor={emp.phone || '—'} />
          <FilaConIcono icono="Contact" color={MARCA.ambar} rotulo="Avisar a" valor={emp.emergency_contact_name || '—'} />
          <FilaConIcono icono="Phone" color={MARCA.ambar} rotulo="Teléfono de emergencia" valor={emp.emergency_contact_phone || '—'} />
          {puedeEditar ? (
            <Pressable onPress={() => setEditando(true)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>Editar contacto</Text>
            </Pressable>
          ) : null}
        </Seccion>

        {hasPermission('emp_documents') ? (
          (emp.employee_documents || []).some((d) => d?.url) ? <ExpedienteEnLinea empleado={emp} /> : (
            <BotonGrande texto="Mi expediente" borde color={MARCA.azulClaro} onPress={() => router.push('/mis-documentos')} />
          )
        ) : null}

        <Historial historial={historial} />
      </ScrollView>
      <EditarContacto emp={emp} abierto={editando} onCerrar={() => setEditando(false)} />
    </>
  );
}
