// Auditoría de tiempos, NATIVO — `AttendanceAuditView` día por día: para un
// día, cada persona de la sala con sus marcas y lo que hay que mirar —marcas
// que faltan, tardanza, día cerrado solo por el sistema, pendiente de Talento
// Humano, editado, apoyo en otra sala, vacación o incapacidad—. Los que tienen
// algo salen primero. Tocar a alguien abre sus marcas del día.
//
// La regla de cada día sale del núcleo (`auditarDia`), la misma del portal.
//
// Dos vistas, como el portal: el DÍA (con flechas o el calendario del sistema)
// y la QUINCENA (`componentes/personas/Quincena`): horas regulares, extra,
// nocturnas, tardanza y ausencias por persona y por sala, «Aprobar todo» y los
// turnos extra declarados. En el día, las marcas pendientes de Talento Humano
// se dan por revisadas (`marcarMarcajesRevisados`) y se CORRIGEN agregando una
// marca con su motivo (`componentes/personas/CorregirMarcas`, la acción del
// portal). Cerrar la quincena está en la vista de Quincena.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchQuincenaTimesheets, marcarMarcajesRevisados } from '@nucleo/data/attendanceAudit';
import { isPendingPunch } from '@nucleo/utils/quincena';
import { auditarDia, ROTULO_MARCA } from '@nucleo/utils/auditoriaDeTiempos';
import { fmtTimeCSTStr } from '@nucleo/utils/quincena';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import Segmentos from '../componentes/Segmentos';
import Fecha from '../componentes/formulario/Fecha';
import Quincena from '../componentes/personas/Quincena';
import CorregirMarcas from '../componentes/personas/CorregirMarcas';
import { PasoDePeriodo } from '../componentes/personas/Piezas';
import { fallo, listo } from '../componentes/Progreso';

/** Lo que hay que mirar de un día, en píldoras. */
function senales(a) {
  const s = [];
  if (a.ts?.is_absent && a.ts?.absence_type === 'VACATION') s.push(['Vacación', MARCA.verde]);
  if (a.ts?.is_absent && a.ts?.absence_type === 'DISABILITY') s.push(['Incapacidad', MARCA.rojo]);
  if (!a.isOff && !a.isFuture && a.inconsistencies.length && !a.ts?.absence_type) s.push([`${a.inconsistencies.length} falta${a.inconsistencies.length > 1 ? 'n' : ''}`, MARCA.rojo]);
  if (a.lateMin > 0) s.push([`${a.lateMin} min tarde`, MARCA.ambar]);
  if (a.isAutoDay) s.push(['Auto-marcado', MARCA.violeta]);
  if (a.isPendDay) s.push(['Pend. TH', MARCA.ambar]);
  if (a.isEditedDay) s.push(['Editado', MARCA.verde]);
  if (a.crossBranchName) s.push([`Apoyo ${a.crossBranchName}`, MARCA.azulClaro]);
  return s;
}

export default function AuditoriaDeTiempos() {
  const { user, getScope, hasPermission } = useAuth();
  const puedeEditar = !!hasPermission?.('time_audit', 'can_edit');
  const [vista, setVista] = useState('dia');
  const [revisados, setRevisados] = useState(() => new Set());
  const [eligiendoDia, setEligiendoDia] = useState(false);
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const turnos = useStaffStore((s) => s.shifts);
  const cargarAsistencia = useStaffStore((s) => s.loadAttendanceLastDays);
  const todas = getScope?.('time_audit') === 'ALL';
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? salaElegida : String(user?.branchId ?? '');
  const [dia, setDia] = useState(hoySV);
  const [ts, setTs] = useState(null);
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(null); // { persona, dia, a }

  useEffect(() => { cargarAsistencia?.(35); }, [cargarAsistencia]);
  useEffect(() => {
    let vivo = true;
    setTs(null);
    fetchQuincenaTimesheets(dia, dia).then(({ data }) => { if (vivo) setTs(data || []); });
    return () => { vivo = false; };
  }, [dia]);

  const shiftById = useMemo(() => new Map((turnos || []).map((t) => [String(t.id), t])), [turnos]);
  const branchNameById = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  const filas = useMemo(() => {
    if (!ts) return [];
    const now = new Date();
    return (empleados || [])
      .filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO')
      .filter((e) => sala === 'ALL' || String(e.branchId ?? e.branch_id) === sala)
      .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.name, e.code, e.role))
      .map((e) => {
        const a = auditarDia({ dateStr: dia, emp: e, shiftById, timesheets: ts, homeBranchId: e.branchId ?? e.branch_id, branchNameById, reviewedPunchIds: revisados, now });
        return { e, a, s: senales(a) };
      })
      .sort((x, y) => (y.s.length - x.s.length) || (ordenDeSala(Number(x.e.branchId)) - ordenDeSala(Number(y.e.branchId))) || String(x.e.name).localeCompare(String(y.e.name)));
  }, [empleados, ts, dia, sala, texto, shiftById, branchNameById, revisados]);
  // Las personas de la sala (para la quincena, sin el cálculo del día).
  const personas = useMemo(() => (empleados || [])
    .filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO')
    .filter((e) => sala === 'ALL' || String(e.branchId ?? e.branch_id) === sala)
    .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.name, e.code, e.role)), [empleados, sala, texto]);
  const revisar = async (e) => {
    // Las marcas del DÍA que esperan a Talento Humano (las mismas que pinta la fila).
    const delDia = filas.find((f) => f.e.id === e.id)?.a.dayPunches.filter((p) => isPendingPunch(p) && !revisados.has(p.id)) ?? [];
    if (!delDia.length) return;
    try {
      await marcarMarcajesRevisados(delDia, { employeeId: e.id, date: dia, revisadoPor: user?.name });
      setRevisados((prev) => new Set([...prev, ...delDia.map((p) => p.id)]));
      listo('Revisado', `${delDia.length} marcaje(s) de ${shortEmployeeName(e)}.`);
    } catch (err) { fallo('No se pudo marcar como revisado', err?.message || ''); }
  };
  const conAlgo = filas.filter((f) => f.s.length).length;
  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];
  const ir = (n) => { Haptics.selectionAsync().catch(() => {}); setDia((d) => sumarDias(d, n)); setAbierto(null); };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Auditoría de tiempos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, código o cargo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargarAsistencia?.(35); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'dia', label: 'Día' }, { id: 'quincena', label: 'Quincena' }]} />
        {vista === 'quincena' ? <Quincena empleados={personas} sucursales={sucursales} puedeEditar={puedeEditar} usuario={user}
          salaNombre={sala === 'ALL' ? null : (sucursales || []).find((b) => String(b.id) === sala)?.name} /> : (
        <>
        <PasoDePeriodo titulo={dia === hoySV() ? 'Hoy' : fechaTexto(dia, { weekday: 'long', day: 'numeric', month: 'long' })}
          apoyo="Toca para elegir otro día" onTocar={() => setEligiendoDia((v) => !v)}
          onAtras={() => ir(-1)} onAdelante={() => ir(1)} puedeAdelante={dia < hoySV()} />
        {eligiendoDia ? (
          <View style={{ marginHorizontal: 16, alignItems: 'center' }}>
            <Fecha valor={dia} hasta={hoySV()} onCambiar={(d) => { setDia(d); setAbierto(null); setEligiendoDia(false); }} />
          </View>
        ) : null}
        {ts ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${filas.length} personas · ${conAlgo} con algo que mirar`}</Text> : null}
        {ts == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : filas.map(({ e, a, s }) => {
          const abiertoEste = abierto === e.id;
          return (
            <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoEste ? null : e.id); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
              <Vidrio radio={18} interactivo tinte={s.some(([, c]) => c === MARCA.rojo) ? 'rgba(240,68,56,0.10)' : undefined}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={e} tamano={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                        {[a.isOff ? (a.isNoSchedule ? 'Sin turno' : 'Libre') : a.shiftStart ? `${hora12(a.shiftStart)} – ${hora12(a.shiftEnd)}` : null,
                          a.entryPunch ? `entró ${fmtTimeCSTStr(a.entryPunch.timestamp)}` : null,
                          a.exitPunch ? `salió ${fmtTimeCSTStr(a.exitPunch.timestamp)}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                  {s.length ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{s.map(([t, c]) => <Pildora key={t} texto={t} color={c} />)}</View> : null}
                  {abiertoEste ? (
                    <View style={{ gap: 4, marginTop: 4 }}>
                      {a.dayPunches.length ? a.dayPunches.map((p) => (
                        <View key={p.id ?? p.timestamp} style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 6 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{ROTULO_MARCA[p.type] ?? p.type}</Text>
                          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{fmtTimeCSTStr(p.timestamp)}</Text>
                        </View>
                      )) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sin marcas este día.</Text>}
                      {a.inconsistencies.map((i) => (
                        <Text key={i.type} style={{ color: MARCA.rojo, fontSize: 13 }}>{`Falta: ${i.label} (${fmtTimeCSTStr(i.expected)})`}</Text>
                      ))}
                      {puedeEditar ? (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                          {!a.isFuture ? (
                            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setCorrigiendo({ persona: e, dia, a }); }}
                              style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}2E`, opacity: pressed ? 0.7 : 1 })}>
                              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Corregir</Text>
                            </Pressable>
                          ) : null}
                          {a.isPendDay ? (
                            <Pressable onPress={() => revisar(e)}
                              style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: `${MARCA.ambar}2E`, opacity: pressed ? 0.7 : 1 })}>
                              <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>Revisado</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        </>
        )}
      </ScrollView>
      <CorregirMarcas objetivo={corrigiendo} usuario={user}
        onCerrar={(guardo) => { setCorrigiendo(null); if (guardo) cargarAsistencia?.(35); }} />
    </>
  );
}
