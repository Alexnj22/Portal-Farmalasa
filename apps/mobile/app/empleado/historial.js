// Historial, ausencias y solicitudes de una persona, NATIVO — las pestañas
// «Historial», «Ausencias» y «Solicitudes» de la ficha del portal
// (`EmployeeDetailView`).
//
// · Historial: la vista `employee_timeline` (contratación, novedades,
//   movimientos de la bitácora, horarios publicados) con el tono de cada
//   evento, los días de un permiso, el antes → después, y por cada novedad
//   viva: ver el respaldo, adjuntarlo (`addDocumentToEvent`), corregirla
//   (`empleado/accion?evento=`) o cancelarla con motivo (`cancelEmployeeEvent`,
//   que revierte lo que ya aplicó). Cada renglón se amarra con su fila real
//   (`historialDeFicha`): la vista no trae el id.
// · Ausencias: el calendario del mes con permisos, incapacidades y los días
//   que paga el seguro (del cuarto en adelante); tocar un día lo filtra.
// · Solicitudes: las de esa persona con su tipo, estado, nota y respuesta, y
//   «Nueva solicitud» a su nombre.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { EVENT_TYPES } from '@nucleo/data/constants';
import { fetchEmployeeTimeline } from '@nucleo/data/employees';
import { fetchEmployeeApprovalRequestsDetail } from '@nucleo/data/requests';
import { REQUEST_STATUS, REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { ausenciasFiltradas, diasDeAusencia, diasDeSeguro, eventoVigente, historialDeFicha, varianteDeEvento } from '@nucleo/utils/historialDeFicha';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import { elegirArchivo } from '../../componentes/sucursal/elegirArchivo';
import Segmentos from '../../componentes/Segmentos';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const corta = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function Enlace({ texto, color = MARCA.azulClaro, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Evento({ ev, emp, puedeEditar, onCambio }) {
  const anular = useStaffStore((s) => s.cancelEmployeeEvent);
  const adjuntarAlEvento = useStaffStore((s) => s.addDocumentToEvent);
  const m = ev.metadata || {};
  const doc = ev.documentId || ev.eventoId
    ? (emp.documents || []).find((d) => String(d.id) === String(ev.documentId) || (ev.eventoId && String(d.event_id) === String(ev.eventoId)))
    : null;
  const vigente = eventoVigente(ev);

  const adjuntar = async () => {
    const a = await elegirArchivo(`respaldo_${ev.type}`);
    if (!a) return;
    Alert.alert('Adjuntar el respaldo', `Se guarda en el expediente de ${shortEmployeeName(emp)}, colgado de este evento.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Adjuntar', onPress: async () => {
        trabajando('Subiendo…');
        try { await adjuntarAlEvento(emp.id, ev.eventoId, a); listo('Respaldo adjunto', a.name); onCambio(); } catch (e) { fallo('No se pudo adjuntar', mensajeAmigable(e)); }
      } },
    ]);
  };
  const cancelar = () => Alert.prompt('Cancelar el evento', 'Si ya cambió algo en la ficha, se revierte. Escribe el motivo: queda en la bitácora.', [
    { text: 'Volver', style: 'cancel' },
    { text: 'Cancelar el evento', style: 'destructive', onPress: async (motivo) => {
      if (!motivo?.trim()) { fallo('Falta el motivo', 'Escribe por qué se cancela.'); return; }
      trabajando('Cancelando…');
      const ok = await Promise.resolve(anular(ev.eventoId, motivo.trim())).catch(() => false);
      if (ok) { listo('Evento cancelado', EVENT_TYPES[ev.type]?.label || ev.type); onCambio(); } else fallo('No se canceló', 'Intenta de nuevo.');
    } },
  ], 'plain-text');

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={18}>
        <View style={{ padding: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Pildora texto={ev.category && ev.category !== ev.type ? ev.category : (EVENT_TYPES[ev.type]?.label || ev.category || ev.type)} color={colorDeVariante(varianteDeEvento(ev.type, EVENT_TYPES))} />
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{corta(ev.date)}{ev.endDate && ev.endDate !== ev.date ? ` → ${corta(ev.endDate)}` : ''}</Text>
            {m.status === 'CANCELLED' ? <Pildora texto="Cancelado" color={MARCA.rojo} /> : null}
            {m.status === 'SUPERSEDED' ? <Pildora texto="Editado" color={colorSistema.texto2} /> : null}
            {m.applyStatus === 'SCHEDULED' ? <Pildora texto="Programado" color={MARCA.violetaClaro} /> : null}
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 14, lineHeight: 19 }}>{ev.note}</Text>
          {m.permissionDates?.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{m.permissionDates.map(corta).join(' · ')}</Text> : null}
          {m.old_value && m.new_value ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${m.old_value} → ${m.new_value}`}</Text> : null}
          {!ev.isSystem && ev.eventoId ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {doc?.url ? <Enlace texto="Ver respaldo" onPress={() => Promise.resolve(openStoredFile(doc.url)).catch(() => fallo('No se pudo abrir', ''))} />
                : puedeEditar && m.status !== 'CANCELLED' ? <Enlace texto="Adjuntar respaldo" color={MARCA.violetaClaro} onPress={adjuntar} /> : null}
              {puedeEditar && vigente ? <Enlace texto="Corregir" onPress={() => router.push({ pathname: '/empleado/accion', params: { id: String(emp.id), evento: String(ev.eventoId) } })} /> : null}
              {puedeEditar && vigente ? <Enlace texto="Cancelar" color={MARCA.rojo} onPress={cancelar} /> : null}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}

function Calendario({ mes, setMes, dias, dia, setDia }) {
  const [y, m] = mes.split('-').map(Number);
  const primero = new Date(y, m - 1, 1).getDay();
  const enMes = new Date(y, m, 0).getDate();
  const celdas = [...Array(primero).fill(null), ...Array.from({ length: enMes }, (_, i) => i + 1)];
  const mover = (n) => { const d = new Date(y, m - 1 + n, 1); setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); setDia(null); };
  const hoy = hoySV();
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Enlace texto="‹" onPress={() => mover(-1)} />
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', textTransform: 'capitalize' }}>{`${MESES[m - 1]} ${y}`}</Text>
            <Enlace texto="›" onPress={() => mover(1)} />
          </View>
          <View style={{ flexDirection: 'row' }}>{DIAS.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>{d}</Text>)}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {celdas.map((n, i) => {
              if (!n) return <View key={`v${i}`} style={{ width: '14.285%', height: 40 }} />;
              const ds = `${mes}-${String(n).padStart(2, '0')}`;
              const c = dias[ds];
              const elegido = dia === ds;
              return (
                <Pressable key={ds} disabled={!c} onPress={() => { Haptics.selectionAsync().catch(() => {}); setDia(elegido ? null : ds); }}
                  style={{ width: '14.285%', height: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: elegido ? MARCA.verde : ds === hoy ? MARCA.azul : c?.incapacidad ? 'rgba(240,68,56,0.18)' : c?.permiso ? 'rgba(247,144,9,0.18)' : 'transparent' }}>
                    <Text style={{ color: elegido || ds === hoy ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: c ? '700' : '400' }}>{n}</Text>
                  </View>
                  {c?.seguro && !elegido ? <View style={{ position: 'absolute', bottom: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: MARCA.violetaClaro }} /> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '700' }}>● Permiso</Text>
            <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '700' }}>● Incapacidad</Text>
            <Text style={{ color: MARCA.violetaClaro, fontSize: 12, fontWeight: '700' }}>● Día 4+ seguro</Text>
          </View>
        </View>
      </Vidrio>
    </View>
  );
}

export default function Historial() {
  const { id, seccion: inicial } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const puedeEditar = !!hasPermission?.('staff_detail', 'can_edit');
  const [seccion, setSeccion] = useState(inicial || 'historial');
  const [filas, setFilas] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [mes, setMes] = useState(hoySV().slice(0, 7));
  const [dia, setDia] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!id) return;
    const { data, error } = await Promise.resolve(fetchEmployeeTimeline(id)).catch((e) => ({ data: null, error: e }));
    setFilas(error ? [] : (data || []));
    if (error) fallo('No se pudo leer el historial', mensajeAmigable(error));
  }, [id]);
  const cargarSolicitudes = useCallback(async () => {
    if (!id) return;
    const data = await Promise.resolve(fetchEmployeeApprovalRequestsDetail(id)).catch(() => null);
    setSolicitudes(data || []);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial
  useEffect(() => { if (seccion === 'solicitudes') cargarSolicitudes(); }, [seccion, cargarSolicitudes]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al abrir la pestaña

  const historial = useMemo(() => historialDeFicha(filas || [], emp?.history || []), [filas, emp]);
  const dias = useMemo(() => diasDeAusencia(historial, hoySV()), [historial]);
  const ausencias = useMemo(() => ausenciasFiltradas(historial, { mes, dia }), [historial, mes, dia]);
  if (!emp) return <Aviso tono="freno" texto="No se encontró a esta persona." />;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: shortEmployeeName(emp), headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); if (seccion === 'solicitudes') await cargarSolicitudes(); setRecargando(false); }} />}>
        <Segmentos activa={seccion} onCambiar={setSeccion} opciones={[
          { id: 'historial', label: 'Historial' }, { id: 'ausencias', label: 'Ausencias' }, { id: 'solicitudes', label: 'Solicitudes' },
        ]} />
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}

        {seccion === 'historial' && filas ? (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${historial.length} eventos`}</Text>
            {historial.map((ev) => <Evento key={ev.id} ev={ev} emp={emp} puedeEditar={puedeEditar} onCambio={cargar} />)}
          </>
        ) : null}

        {seccion === 'ausencias' && filas ? (
          <>
            <Calendario mes={mes} setMes={setMes} dias={dias} dia={dia} setDia={setDia} />
            {ausencias.map((ev) => {
              const incap = ev.type === 'DISABILITY';
              const m = ev.metadata || {};
              const seguro = diasDeSeguro(ev);
              return (
                <View key={ev.id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={16} tinte={incap ? 'rgba(240,68,56,0.12)' : 'rgba(247,144,9,0.12)'}>
                    <View style={{ padding: 12, gap: 4 }}>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Pildora texto={incap ? 'Incapacidad' : (m.hours || m.hoursOnly) ? 'Permiso por horas' : 'Permiso'} color={incap ? MARCA.rojo : MARCA.ambar} />
                        {m.days ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${m.days} día${Number(m.days) === 1 ? '' : 's'}`}</Text> : null}
                        {seguro ? <Pildora texto={`${seguro}d seguro`} color={MARCA.violetaClaro} /> : null}
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {m.permissionDates?.length ? m.permissionDates.map(corta).join(' · ') : `${corta(ev.date)}${m.endDate && m.endDate !== ev.date ? ` → ${corta(m.endDate)}` : ''}`}
                      </Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{ev.note}</Text>
                    </View>
                  </Vidrio>
                </View>
              );
            })}
            {!ausencias.length ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 12 }}>{dia ? 'Sin ausencias ese día.' : 'Sin ausencias este mes.'}</Text> : null}
          </>
        ) : null}

        {seccion === 'solicitudes' ? (
          <>
            {solicitudes == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : solicitudes.map((r) => {
              const t = REQUEST_TYPES[r.type] || { label: r.type };
              const e = REQUEST_STATUS[r.status] || { label: r.status };
              return (
                <Pressable key={r.id} onPress={() => router.push(`/solicitud/${r.id}`)} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={16} interactivo>
                    <View style={{ padding: 12, gap: 4 }}>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        <Pildora texto={t.label} color={colorDeVariante(t.variante)} />
                        <Pildora texto={e.label} color={colorDeVariante(e.variante)} />
                      </View>
                      {r.note ? <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{r.note}</Text> : null}
                      {r.approver_note ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{`Nota: ${r.approver_note}`}</Text> : null}
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{corta(r.created_at)}</Text>
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}
            {solicitudes && !solicitudes.length ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 12 }}>Sin solicitudes.</Text> : null}
            <View style={{ marginHorizontal: 16 }}>
              <BotonGrande texto="Nueva solicitud a su nombre" borde color={MARCA.azulClaro}
                onPress={() => router.push({ pathname: '/nueva/personal', params: { empleado: String(emp.id) } })} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
