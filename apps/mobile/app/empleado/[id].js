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
// cargos, sala, contacto, contrato) y «Expediente» la del expediente
// (`empleado/expediente`: foto, documentos por sección, estudios y la cuenta
// de la planilla).
//
// Y las acciones de la cabecera del portal, con los MISMOS permisos:
// «Historial, ausencias y solicitudes» (`empleado/historial`), «Acción de
// personal» (`empleado/accion`), «Sanción» (`empleado/sancion`), «Ingreso en
// vacaciones» si está gozándolas (`empleado/ingreso-vacaciones`), restablecer
// la contraseña (`fijarContrasenaDeEmpleado`), el carné del día —imprimirlo
// en la caja de una sala o anular el vigente— y, si está de baja,
// «Recontratar» (`empleado/recontratar`).
//
// Como las tarjetas del perfil del portal, también la edad, las tardanzas
// acumuladas del mes y el almuerzo/receso del horario; y, con el permiso del
// carné del día, «Reimprimir el carné de plástico» (la etiqueta de 85 × 30 mm
// con el PIN permanente, por AirPrint — `plataforma/carnePrint`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { EVENT_TYPES } from '@nucleo/data/constants';
import { estadoDePersona } from '@nucleo/utils/estadoDePersona';
import { alertasDePersona, datosPendientesDePersona } from '@nucleo/utils/alertasDePersona';
import { cumpleEn, historialDePerfil, semanaDelPerfil, tiempoEnLaEmpresa } from '@nucleo/utils/miPerfil';
import { cadenaDeSuperiores } from '@nucleo/utils/roles';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { calcAge } from '@nucleo/utils/ageUtils';
import { fetchCredenciales } from '@nucleo/data/employees';
import { imprimirEtiquetaDeCarne } from '../../plataforma/carnePrint';
import { anotar } from '@nucleo/data/audit';
import { fijarContrasenaDeEmpleado } from '@nucleo/data/auth';
import { anularCarneTemporal, carneVigente, fetchCarnesTemporales } from '@nucleo/data/carneTemporal';
import { vacacionEnCurso } from '@nucleo/utils/reingresoYRecontratacion';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { useCarneDePapel } from '../../componentes/personas/CarneDePapel';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion, PantallaSinDato } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { iconoDe } from '../../tema/iconos';
import { PildoraDeCargo } from '../../componentes/personas/Piezas';
import { textoDeAlerta } from '../../componentes/personas/TarjetaPersona';
import IconoFijo from '../../componentes/IconoFijo';

const fecha = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const horaCorta = (h) => (hora12(h) || '').replace(':00', '').replace(/\s?a\.\s?m\./, 'a').replace(/\s?p\.\s?m\./, 'p');
const soloDigitos = (tel) => String(tel || '').replace(/\D/g, '');

function Accion({ icono, rotulo, color, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 16, backgroundColor: `${color}22`, opacity: pressed ? 0.7 : 1 })}>
      {/* Tamaño fijo: con `matchContents` el ícono se medía tarde en iPhone y
          salía fuera del botón (como en la tarjeta de Personal). */}
      <IconoFijo name={iconoDe(icono)} size={20} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{rotulo}</Text>
    </Pressable>
  );
}

// Una casilla de la cuadrícula de acciones: ícono en su círculo y el nombre,
// tres por renglón (2026-11-12, usuario: «Acciones, sanción, contraseña…
// combinemos acciones y sanciones, que se vea muy visual y práctico»).
function Casilla({ icono, rotulo, color, onPress, enRenglon = false }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={rotulo}
      style={({ pressed }) => ({ ...(enRenglon ? { flex: 1 } : { width: '31.5%' }), alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 16,
        backgroundColor: `${color}1A`, borderWidth: 0.5, borderColor: `${color}40`, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}2E` }}>
        <IconoFijo name={iconoDe(icono)} size={19} color={color} />
      </View>
      <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '700', textAlign: 'center' }} numberOfLines={2}>{rotulo}</Text>
    </Pressable>
  );
}

// Las acciones de personal más usadas, cada una directo a su formulario
// (`empleado/accion?tipo=…`); «Otra acción» abre el selector con el resto
// (inducción y las demás). El orden: lo del día a día primero, la baja
// al final y en rojo.
const ACCIONES = [
  { tipo: 'VACATION', rotulo: 'Vacaciones', icono: 'Calendar', color: MARCA.verde },
  { tipo: 'DISABILITY', rotulo: 'Incapacidad', icono: 'HeartPulse', color: '#F472B6' },
  { tipo: 'PERMIT', rotulo: 'Permiso', icono: 'ClipboardList', color: MARCA.ambar },
  { tipo: 'TRANSFER', rotulo: 'Traslado', icono: 'ArrowRightLeft', color: MARCA.azulClaro },
  { tipo: 'SUPPORT', rotulo: 'Apoyo temporal', icono: 'Building2', color: '#E879F9' },
  { tipo: 'PROMOTION', rotulo: 'Cambio de cargo', icono: 'TrendingUp', color: MARCA.violetaClaro },
  { tipo: 'SALARY', rotulo: 'Ajuste salarial', icono: 'DollarSign', color: MARCA.verde },
  { tipo: 'CODE_CHANGE', rotulo: 'Cambio de código', icono: 'IdCard', color: MARCA.violetaClaro },
];

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
  const imprimirCarne = useCarneDePapel();
  const [carne, setCarne] = useState(undefined); // undefined = leyendo · null = no tiene · false = no se pudo leer
  const leerCarne = useCallback(async () => {
    if (!id) return;
    const { data, error } = await Promise.resolve(fetchCarnesTemporales(id, 5)).catch((e) => ({ data: null, error: e }));
    setCarne(error ? false : ((data || []).find(carneVigente) || null));
  }, [id]);
  const puedeCarne = !!hasPermission?.('carne_temporal', 'can_edit');
  useEffect(() => { if (puedeCarne) leerCarne(); }, [puedeCarne, leerCarne]);  

  const sala = useMemo(() => (sucursales || []).find((b) => String(b.id) === String(emp?.branchId ?? emp?.branch_id)), [sucursales, emp]);
  const historial = useMemo(() => historialDePerfil(emp?.history || [], emp?.hire_date || emp?.hireDate, sala?.name), [emp, sala]);
  const semana = useMemo(() => semanaDelPerfil(emp?.weeklySchedule, turnos || [], hoy), [emp, turnos, hoy]);
  if (!emp) return <PantallaSinDato texto="No se encontró a esta persona (o no está en tu alcance)." />;

  const estado = estadoDePersona(emp);
  const alertas = alertasDePersona(emp);
  const cargos = [emp.role, emp.secondary_role || emp.secondaryRole].filter(Boolean);
  const [padre] = cadenaDeSuperiores(roles || [], emp.role_id);
  const respondeA = (roles || []).find((r) => String(r.id) === String(padre))?.name || null;
  const tel = soloDigitos(emp.phone);
  const cumple = cumpleEn(emp.birth_date || emp.birthDate, hoy);
  const areas = (emp.assigned_branch_ids || []).map((b) => (sucursales || []).find((s) => String(s.id) === String(b))?.name).filter(Boolean);
  const inactiva = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'].includes(emp.status);
  // Lo mismo que las tarjetas de arriba del perfil del portal: la edad y las
  // tardanzas acumuladas de las marcas que trae la ficha.
  const edad = calcAge(emp.birth_date || emp.birthDate, hoy);
  const tardanzas = (emp.attendance || []).filter((a) => a.type === 'LATE').length;
  // El carné de PLÁSTICO (85 × 30 mm, con el PIN permanente): el PIN no viaja
  // con la ficha —es una credencial— y se pide al apretar, como en el portal.
  // Sale por AirPrint, nunca por la caja de la sala.
  const reimprimirPlastico = async () => {
    trabajando('Preparando la etiqueta…');
    try {
      const mapa = await fetchCredenciales([emp.id]);
      const r = await imprimirEtiquetaDeCarne(null, { nombre: emp.name, valor: mapa.get(emp.id)?.kiosk_pin });
      if (r.ok) listo('Etiqueta lista', 'Se mandó a la impresora.');
      else fallo('No se pudo imprimir el carné', r.motivo);
    } catch (e) { fallo('No se pudo imprimir el carné', mensajeAmigable(e, 'Intenta de nuevo.')); }
  };
  // Restablecer la contraseña: la MISMA del portal (`set-employee-password`).
  // Si el servidor da una temporal, se muestra una sola vez y se puede compartir.
  const restablecer = () => Alert.alert('Restablecer la contraseña', `¿Restablecer la contraseña de ${shortEmployeeName(emp)}? Deberá cambiarla en su próximo acceso.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Restablecer', onPress: async () => {
      trabajando('Restableciendo…');
      try {
        const { data, error } = await fijarContrasenaDeEmpleado(emp.username, '1234', { employeeId: emp.id });
        if (error) throw error;
        if (!data?.ok) throw new Error('No se pudo restablecer.');
        if (data.tempPassword) {
          listo('Contraseña temporal', 'Anótala o compártela: no se puede volver a ver.');
          Alert.alert('Contraseña temporal', `Usuario: ${emp.username}\nContraseña: ${data.tempPassword}`, [
            { text: 'Compartir', onPress: () => Share.share({ message: `Usuario: ${emp.username}\nContraseña temporal: ${data.tempPassword}` }).catch(() => {}) },
            { text: 'Listo' },
          ]);
        } else listo('Contraseña restablecida', `${shortEmployeeName(emp)} deberá cambiarla en su próximo acceso.`);
      } catch (e) { fallo('No se restableció', mensajeAmigable(e, 'Error de conexión.')); }
    } },
  ]);
  const anularCarne = () => Alert.alert('¿Anular el carné vigente?', 'Ese papel deja de servir de inmediato. Si lo necesita, se imprime otro.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Anular', style: 'destructive', onPress: async () => {
      trabajando('Anulando…');
      const r = await Promise.resolve(anularCarneTemporal(carne.id, { employeeId: emp.id })).catch((e) => ({ ok: false, motivo: e?.message }));
      if (r?.ok) listo('Carné anulado', 'Ese papel ya no sirve.'); else fallo('No se anuló', r?.motivo || 'Intenta de nuevo.');
      leerCarne();
    } },
  ]);
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
        <Vidrio radio={20}>
          <View style={{ padding: 18, gap: 10, alignItems: 'center' }}>
            <Avatar empleado={emp} tamano={88} />
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

        {/* Lo de todos los días, arriba y a un toque (antes, al final de la ficha). */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {hasPermission?.('staff_list', 'can_edit') && !inactiva ? (
            <Casilla enRenglon icono="PenLine" rotulo="Editar la ficha" color={MARCA.azulClaro} onPress={() => router.push({ pathname: '/empleado/editar', params: { id: String(emp.id) } })} />
          ) : null}
          {hasPermission?.('staff_detail', 'can_view') ? (
            <Casilla enRenglon icono="FolderOpen" rotulo="Expediente" color={MARCA.azulClaro} onPress={() => router.push({ pathname: '/empleado/expediente', params: { id: String(emp.id) } })} />
          ) : null}
          <Casilla enRenglon icono="ClipboardList" rotulo="Historial y ausencias" color={MARCA.azulClaro} onPress={() => router.push({ pathname: '/empleado/historial', params: { id: String(emp.id) } })} />
        </View>

        {hasPermission?.('staff_list', 'can_edit') && inactiva ? (
          <BotonGrande texto="Recontratar" color={MARCA.verde} onPress={() => router.push({ pathname: '/empleado/recontratar', params: { id: String(emp.id) } })} />
        ) : null}

        {/* Lo que hay que saber, diciendo QUÉ (usuario, 2026-11-12: «me dice
            falta 1 dato, vence en 49 d, pero ¿qué? si entro no me da info»).
            Cada renglón lleva a donde se arregla. */}
        {alertas.length ? (
          <Seccion titulo="Lo que hay que saber">
            {alertas.map((a, i) => {
              const color = colorDeVariante(a.variante);
              const faltan = a.key === 'pendiente' ? datosPendientesDePersona(emp) : [];
              const detalle = a.key === 'pendiente' ? faltan.join(' · ') : a.key === 'documento' ? `${a.title}. Se renueva en el expediente.` : a.title;
              const destino = a.key === 'pendiente' && hasPermission?.('staff_list', 'can_edit') ? '/empleado/editar'
                : (a.key === 'pendiente' || a.key === 'documento') && hasPermission?.('staff_detail', 'can_view') ? '/empleado/expediente' : null;
              return (
                <Pressable key={a.key} disabled={!destino} onPress={() => router.push({ pathname: destino, params: { id: String(emp.id) } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}26` }}>
                    <IconoFijo name={iconoDe(a.icono)} size={17} color={color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{textoDeAlerta(a, emp)}</Text>
                    {a.key === 'pendiente' && faltan.length > 1 ? (
                      // Cada dato que falta, como etiqueta: un párrafo de 18
                      // nombres no se lee. Con muchos, los primeros y «N más».
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                        {faltan.slice(0, 8).map((d) => (
                          <View key={d} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: `${color}1F` }}>
                            <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '600' }}>{d}</Text>
                          </View>
                        ))}
                        {faltan.length > 8 ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', alignSelf: 'center' }}>{`y ${faltan.length - 8} más`}</Text> : null}
                      </View>
                    ) : detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
                  </View>
                  {destino ? <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text> : null}
                </Pressable>
              );
            })}
          </Seccion>
        ) : null}

        {hasPermission?.('staff_detail', 'can_edit') && !inactiva ? (
          <Seccion titulo="Acciones">
            {vacacionEnCurso(emp, hoy) ? (
              <BotonGrande texto="Ingreso en vacaciones" color={MARCA.ambar} onPress={() => router.push({ pathname: '/empleado/ingreso-vacaciones', params: { id: String(emp.id) } })} />
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
              {ACCIONES.map((a) => (
                <Casilla key={a.tipo} icono={a.icono} rotulo={a.rotulo} color={a.color}
                  onPress={() => router.push({ pathname: '/empleado/accion', params: { id: String(emp.id), tipo: a.tipo } })} />
              ))}
              <Casilla icono="ShieldAlert" rotulo="Sanción" color={MARCA.ambar} onPress={() => router.push({ pathname: '/empleado/sancion', params: { id: String(emp.id) } })} />
              <Casilla icono="KeyRound" rotulo="Contraseña" color={MARCA.violetaClaro} onPress={restablecer} />
              <Casilla icono="Plus" rotulo="Otra acción" color={colorSistema.texto2} onPress={() => router.push({ pathname: '/empleado/accion', params: { id: String(emp.id) } })} />
              <Casilla icono="LogOut" rotulo="Baja" color={MARCA.rojo} onPress={() => router.push({ pathname: '/empleado/accion', params: { id: String(emp.id), tipo: 'TERMINATION' } })} />
            </View>
          </Seccion>
        ) : null}

        {semana.length ? (
          <Seccion titulo="Horario de esta semana" pie={semana.some((d) => d.turno) ? 'Almuerzo / receso: definido por ley en cada día con turno.' : null}>
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
          <Dato rotulo="Tardanzas (mes)" valor={`${tardanzas} acumulada${tardanzas === 1 ? '' : 's'}`} fuerte={tardanzas > 0} />
          {emp.contract_type ? <Dato rotulo="Contrato" valor={emp.contract_type} /> : null}
          {emp.weekly_hours ? <Dato rotulo="Horas por semana" valor={String(emp.weekly_hours)} /> : null}
          <Dato rotulo="Estado" valor={emp.status || '—'} />
        </Seccion>

        <Seccion titulo="Personal y contacto">
          <Dato primero rotulo="Nacimiento" valor={`${fecha(emp.birth_date || emp.birthDate)}${cumple ? ` · cumple ${cumple}` : ''}`} />
          <Dato rotulo="Edad" valor={edad != null ? `${edad} años` : 'N/D'} />
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
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{EVENT_TYPES[ev.type]?.label ?? (ev.type === 'HIRING' ? 'Ingreso' : 'Movimiento')}</Text>
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

        {puedeCarne && !inactiva ? (
          <Seccion titulo="Carné del día" pie={carne === false ? 'No se pudo saber si tiene uno vigente.' : carne ? `Tiene uno vigente: vence ${hora12(carne.vence_el)}.` : carne === null ? 'No tiene uno vigente.' : null}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Accion icono="Printer" rotulo="Imprimir" color={MARCA.azulClaro}
                onPress={() => imprimirCarne({ employeeId: emp.id, nombre: emp.name, cargo: emp.role || '', sala: sala?.name || '', motivo: 'Desde el perfil', alTerminar: leerCarne })} />
              {carne ? <Accion icono="Ban" rotulo="Anular el vigente" color={MARCA.rojo} onPress={anularCarne} /> : null}
            </View>
            <BotonGrande texto="Reimprimir el carné de plástico" borde color={MARCA.azulClaro} onPress={reimprimirPlastico} />
          </Seccion>
        ) : null}
      </ScrollView>
    </>
  );
}
