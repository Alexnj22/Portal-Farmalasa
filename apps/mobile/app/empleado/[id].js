// La ficha de una persona, NATIVA — lo que el expediente del portal muestra de
// LECTURA: la foto y el estado de hoy, sus cargos con su color, lo que hay que
// saber (alertas del expediente), su horario de esta semana, los datos
// laborales (sala, ingreso y antigüedad, contrato), los personales y de
// contacto, y su historial. Llamar y escribir por WhatsApp desde la cabecera.
//
// Lo sensible respeta la MISMA llave que el portal, que decide el servidor: el
// sueldo, el banco y la cuenta sólo llegan con `staff_salary` (y el arranque
// marca `salario_conocido`); el DUI, el ISSS y la AFP sólo con la llave de
// identidad (`identidad_conocida`). Sin la llave la sección no se pinta.
//
// «Editar la ficha» abre la edición nativa (`empleado/editar`: nombre, código,
// cargos, sala, contacto, contrato); el resto del expediente sigue en el
// portal, y el botón del pie lo abre ahí.
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { EVENT_TYPES } from '@nucleo/data/constants';
import { estadoDePersona } from '@nucleo/utils/estadoDePersona';
import { alertasDePersona } from '@nucleo/utils/alertasDePersona';
import { cumpleEn, historialDePerfil, semanaDelPerfil, tiempoEnLaEmpresa } from '@nucleo/utils/miPerfil';
import { cadenaDeSuperiores } from '@nucleo/utils/roles';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { anotar } from '@nucleo/data/audit';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { iconoDe } from '../../tema/iconos';
import { PildoraDeCargo } from '../../componentes/personas/Piezas';

const fecha = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const horaCorta = (h) => (hora12(h) || '').replace(':00', '').replace(/\s?a\.\s?m\./, 'a').replace(/\s?p\.\s?m\./, 'p');
const soloDigitos = (tel) => String(tel || '').replace(/\D/g, '');

function Accion({ icono, rotulo, color, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 16, backgroundColor: `${color}22`, opacity: pressed ? 0.7 : 1 })}>
      <Host matchContents><Icon name={iconoDe(icono)} size={20} color={color} /></Host>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{rotulo}</Text>
    </Pressable>
  );
}

export default function Empleado() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const roles = useStaffStore((s) => s.roles);
  const turnos = useStaffStore((s) => s.shifts);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const [cuantos, setCuantos] = useState(10);
  const hoy = hoySV();

  const sala = useMemo(() => (sucursales || []).find((b) => String(b.id) === String(emp?.branchId ?? emp?.branch_id)), [sucursales, emp]);
  const historial = useMemo(() => historialDePerfil(emp?.history || [], emp?.hire_date || emp?.hireDate, sala?.name), [emp, sala]);
  const semana = useMemo(() => semanaDelPerfil(emp?.weeklySchedule, turnos || [], hoy), [emp, turnos, hoy]);
  if (!emp) return <Aviso tono="freno" texto="No se encontró a esta persona (o no está en tu alcance)." />;

  const estado = estadoDePersona(emp);
  const alertas = alertasDePersona(emp);
  const cargos = [emp.role, emp.secondary_role || emp.secondaryRole].filter(Boolean);
  const [padre] = cadenaDeSuperiores(roles || [], emp.role_id);
  const respondeA = (roles || []).find((r) => String(r.id) === String(padre))?.name || null;
  const tel = soloDigitos(emp.phone);
  const cumple = cumpleEn(emp.birth_date || emp.birthDate, hoy);
  const areas = (emp.assigned_branch_ids || []).map((b) => (sucursales || []).find((s) => String(s.id) === String(b))?.name).filter(Boolean);
  const contactar = (via) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    anotar(via === 'wa' ? 'PERSONAL_WHATSAPP' : 'PERSONAL_LLAMAR', emp.id, { desde: 'app-ficha' });
    const tel503 = tel.length === 8 ? `503${tel}` : tel;
    Linking.openURL(via === 'wa' ? `https://wa.me/${tel503}` : `tel:${tel}`).catch(() => {});
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: shortEmployeeName(emp), headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Vidrio radio={24}>
          <View style={{ padding: 18, gap: 10, alignItems: 'center' }}>
            <Avatar empleado={emp} tamano={84} />
            <Text style={{ color: colorSistema.texto, fontSize: 21, fontWeight: '800', textAlign: 'center' }}>{emp.name}</Text>
            {estado ? <Pildora texto={`${estado.texto}${estado.hasta ? ` · vuelve el ${estado.hasta}` : ''}`} color={colorDeVariante(estado.variante)} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {cargos.map((c) => <PildoraDeCargo key={c} cargo={c} />)}
            </View>
            {respondeA ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Responde a ${respondeA}`}</Text> : null}
            {tel.length >= 8 ? (
              <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 }}>
                <Accion icono="MessageCircle" rotulo="WhatsApp" color={MARCA.verde} onPress={() => contactar('wa')} />
                <Accion icono="Phone" rotulo="Llamar" color={MARCA.azulClaro} onPress={() => contactar('tel')} />
              </View>
            ) : null}
          </View>
        </Vidrio>

        {alertas.length ? (
          <Seccion titulo="Lo que hay que saber">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {alertas.map((a) => <Pildora key={a.key} texto={a.texto} color={colorDeVariante(a.variante)} />)}
            </View>
          </Seccion>
        ) : null}

        {semana.length ? (
          <Seccion titulo="Horario de esta semana">
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {semana.map((d) => {
                const esHoy = d.fecha === hoy;
                return (
                  <View key={d.id} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 14,
                    backgroundColor: esHoy ? MARCA.azul : d.turno ? 'rgba(127,127,127,0.14)' : 'transparent' }}>
                    <Text style={{ color: esHoy ? '#fff' : colorSistema.texto2, fontSize: 11, fontWeight: '700' }}>{d.short}</Text>
                    <Text style={{ color: esHoy ? '#fff' : colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{Number(d.fecha.slice(8))}</Text>
                    <Text style={{ color: esHoy ? '#fff' : colorSistema.texto2, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>
                      {d.turno ? `${horaCorta(d.turno.start)}\n${horaCorta(d.turno.end)}` : 'Libre'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Seccion>
        ) : null}

        <Seccion titulo="Laboral">
          <Dato primero rotulo="Sala" valor={sala?.name || 'Sin sala'} />
          {areas.length >= 2 ? <Dato rotulo="Cubre" valor={areas.join(', ')} /> : null}
          {emp.code ? <Dato rotulo="Código" valor={String(emp.code)} /> : null}
          <Dato rotulo="Ingreso" valor={fecha(emp.hire_date || emp.hireDate)} />
          <Dato rotulo="En la empresa" valor={tiempoEnLaEmpresa(emp.hire_date || emp.hireDate, hoy)} />
          {emp.contract_type ? <Dato rotulo="Contrato" valor={emp.contract_type} /> : null}
          {emp.weekly_hours ? <Dato rotulo="Horas por semana" valor={String(emp.weekly_hours)} /> : null}
          <Dato rotulo="Estado" valor={emp.status || '—'} />
        </Seccion>

        <Seccion titulo="Personal y contacto">
          <Dato primero rotulo="Nacimiento" valor={`${fecha(emp.birth_date || emp.birthDate)}${cumple ? ` · cumple ${cumple}` : ''}`} />
          {emp.blood_type ? <Dato rotulo="Tipo de sangre" valor={emp.blood_type} /> : null}
          <Dato rotulo="Celular" valor={emp.phone || '—'} />
          {emp.email ? <Dato rotulo="Correo" valor={emp.email} /> : null}
          {emp.address ? <Dato rotulo="Dirección" valor={emp.address} /> : null}
          <Dato rotulo="Avisar a" valor={emp.emergency_contact_name || '—'} />
          <Dato rotulo="Teléfono de emergencia" valor={emp.emergency_contact_phone || '—'} />
        </Seccion>

        {emp.identidad_conocida ? (
          <Seccion titulo="Identidad">
            <Dato primero rotulo="DUI" valor={emp.dui || '—'} />
            {emp.dui_lugar_expedicion ? <Dato rotulo="Expedido en" valor={`${emp.dui_lugar_expedicion}${emp.dui_fecha_expedicion ? ` · ${fecha(emp.dui_fecha_expedicion)}` : ''}`} /> : null}
            {emp.alt_identity_document ? <Dato rotulo="Otro documento" valor={emp.alt_identity_document} /> : null}
            <Dato rotulo="ISSS" valor={emp.isss_number || '—'} />
            <Dato rotulo="AFP" valor={emp.afp_number || '—'} />
          </Seccion>
        ) : null}

        {emp.salario_conocido ? (
          <Seccion titulo="Pago">
            <Dato primero rotulo="Sueldo base" valor={emp.base_salary != null ? formatMoney(emp.base_salary) : '—'} />
            <Dato rotulo="Banco" valor={emp.bank_name || '—'} />
            <Dato rotulo="Cuenta" valor={emp.account_number || '—'} />
          </Seccion>
        ) : null}

        <Seccion titulo={`Historial · ${historial.length}`}>
          {historial.slice(0, cuantos).map((ev, i) => (
            <View key={ev.id ?? i} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{EVENT_TYPES[ev.type]?.label ?? (ev.type === 'HIRING' ? 'Ingreso' : ev.type)}</Text>
                {ev.note ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{ev.note}</Text> : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaTexto(ev.date, { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            </View>
          ))}
          {historial.length > cuantos ? (
            <Pressable onPress={() => setCuantos((n) => n + 20)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Ver más</Text>
            </Pressable>
          ) : null}
        </Seccion>

        {hasPermission?.('staff_list', 'can_edit') && !['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'].includes(emp.status) ? (
          <BotonGrande texto="Editar la ficha" onPress={() => router.push({ pathname: '/empleado/editar', params: { id: String(emp.id) } })} />
        ) : null}
        {hasPermission?.('staff_detail', 'can_view') ? (
          <BotonGrande texto="Expediente completo (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: `/personal/empleado/${emp.id}`, nombre: shortEmployeeName(emp) } })} />
        ) : null}
      </ScrollView>
    </>
  );
}
