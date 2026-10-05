// Auditoría de tiempos, NATIVO — `AttendanceAuditView` día por día: para un
// día, cada persona de la sala con sus marcas y lo que hay que mirar —marcas
// que faltan, tardanza, día cerrado solo por el sistema, pendiente de Talento
// Humano, editado, apoyo en otra sala, vacación o incapacidad—. Los que tienen
// algo salen primero. Tocar a alguien abre sus marcas del día.
//
// La regla de cada día sale del núcleo (`auditarDia`), la misma del portal.
// Corregir marcas, aprobar y cerrar la quincena siguen en el portal.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchQuincenaTimesheets } from '@nucleo/data/attendanceAudit';
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
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

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
  const { user, getScope } = useAuth();
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
        const a = auditarDia({ dateStr: dia, emp: e, shiftById, timesheets: ts, homeBranchId: e.branchId ?? e.branch_id, branchNameById, now });
        return { e, a, s: senales(a) };
      })
      .sort((x, y) => (y.s.length - x.s.length) || (ordenDeSala(Number(x.e.branchId)) - ordenDeSala(Number(y.e.branchId))) || String(x.e.name).localeCompare(String(y.e.name)));
  }, [empleados, ts, dia, sala, texto, shiftById, branchNameById]);
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
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={22}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable onPress={() => ir(-1)} hitSlop={8} style={{ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 24 }}>‹</Text></Pressable>
              <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{dia === hoySV() ? 'Hoy' : fechaTexto(dia, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
              <Pressable disabled={dia >= hoySV()} onPress={() => ir(1)} hitSlop={8} style={{ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: dia >= hoySV() ? 0.3 : 1 }}><Text style={{ color: MARCA.azulClaro, fontSize: 24 }}>›</Text></Pressable>
            </View>
          </Vidrio>
        </View>
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
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(e)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
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
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Corregir, aprobar y cerrar quincena (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/auditoria-de-tiempos', nombre: 'Auditoría de tiempos' } })} />
        </View>
      </ScrollView>
    </>
  );
}
