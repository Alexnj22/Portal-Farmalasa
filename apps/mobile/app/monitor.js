// Monitor en tiempo real, NATIVO — `AttendanceMonitorView`: quién está
// trabajando, haciendo horas extra, en pausa, sin marcar o ya terminó, ahora
// mismo, y quién llegó tarde y cuánto.
//
// Los seis contadores del portal (Total, En turno, Horas extra, En pausa, Con
// atraso, Pendientes) filtran al tocarlos; sin filtro, la lista se ordena como
// el tablero del portal: una sección por estado (Trabajando / En pausa / Sin
// marcar / Finalizado) y dentro, por sala. Cada persona con su cargo, su turno,
// el almuerzo y la lactancia del día y sus tres últimas marcas.
//
// El estado de cada persona sale del núcleo (`estadoDeAsistencia`), el mismo
// cálculo del portal; las marcaciones, de `loadAttendanceLastDays`. Se relee
// cada 30 segundos mientras la pantalla está a la vista (punto «En vivo»).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { COLUMNAS_DE_ASISTENCIA, compararAsistencia, estadoDeAsistencia, ROTULO_ESTADO_ASISTENCIA } from '@nucleo/utils/estadoDeAsistencia';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { Contadores, Encabezado, Marcas, PildoraDeCargo } from '../componentes/personas/Piezas';

const COLOR = { working: MARCA.verde, pause: MARCA.ambar, pending: colorSistema.texto2, finished: MARCA.azulClaro };
const columnaDe = (estado) => COLUMNAS_DE_ASISTENCIA.find((c) => c.estados.includes(estado))?.id ?? 'pending';
const PAUSA = new Set(['LUNCH', 'LACTATION', 'BUSINESS_OUT']);

// Los filtros de los contadores: exactamente los de `statusTab` del portal.
const FILTROS = {
  WORKING: (f) => f.status === 'WORKING',
  EXTRA: (f) => f.status === 'EXTRA_WORKING',
  PAUSE: (f) => PAUSA.has(f.status),
  LATE: (f) => f.isLate && f.status !== 'FINISHED',
  PENDING: (f) => f.status === 'PENDING',
  FINISHED: (f) => f.status === 'FINISHED',
};

export default function Monitor() {
  const { user, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const turnos = useStaffStore((s) => s.shifts);
  const cargarAsistencia = useStaffStore((s) => s.loadAttendanceLastDays);
  const todas = getScope?.('monitor') === 'ALL';
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? salaElegida : String(user?.branchId ?? '');
  const [filtro, setFiltro] = useState(null);
  const [texto, setTexto] = useState('');
  const [ahora, setAhora] = useState(() => new Date());
  const [recargando, setRecargando] = useState(false);

  // En vivo mientras se mira: marcas cada 30 s y el reloj cada 30 s.
  useFocusEffect(useCallback(() => {
    cargarAsistencia?.(2);
    const t = setInterval(() => { cargarAsistencia?.(2); setAhora(new Date()); }, 30_000);
    return () => clearInterval(t);
  }, [cargarAsistencia]));
  useEffect(() => { setAhora(new Date()); }, [empleados]);

  const filas = useMemo(() => (empleados || [])
    .filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO')
    .filter((e) => sala === 'ALL' || String(e.branchId ?? e.branch_id) === sala)
    .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.name, e.code, e.role))
    .map((e) => ({ e, ...estadoDeAsistencia(e, turnos || [], ahora) })), [empleados, turnos, ahora, sala, texto]);

  const n = (fn) => filas.filter(fn).length;
  const contadores = [
    { id: 'ALL', rotulo: 'Total', valor: filas.length, color: colorSistema.texto },
    { id: 'WORKING', rotulo: 'En turno', valor: n(FILTROS.WORKING), color: MARCA.verde },
    { id: 'EXTRA', rotulo: 'Horas extra', valor: n(FILTROS.EXTRA), color: MARCA.violetaClaro },
    { id: 'PAUSE', rotulo: 'En pausa', valor: n(FILTROS.PAUSE), color: MARCA.ambar },
    { id: 'LATE', rotulo: 'Con atraso', valor: n(FILTROS.LATE), color: MARCA.rojo },
    { id: 'PENDING', rotulo: 'Pendientes', valor: n(FILTROS.PENDING), color: colorSistema.texto2 },
  ];
  const visibles = filas.filter((f) => !filtro || filtro === 'ALL' || FILTROS[filtro]?.(f));

  // Sin filtro: el tablero del portal, una sección por estado; con filtro, por sala.
  const secciones = useMemo(() => {
    const ordenadas = [...visibles].sort(compararAsistencia);
    if (!filtro || filtro === 'ALL') {
      return COLUMNAS_DE_ASISTENCIA.map((c) => ({ id: c.id, titulo: c.label, color: COLOR[c.id], filas: ordenadas.filter((f) => columnaDe(f.status) === c.id) }))
        .filter((s) => s.filas.length);
    }
    const m = new Map();
    for (const f of ordenadas) { const k = String(f.e.branchId ?? f.e.branch_id); if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
    return [...m.entries()].sort((a, b) => ordenDeSala(Number(a[0])) - ordenDeSala(Number(b[0])))
      .map(([k, l]) => ({ id: k, titulo: (sucursales || []).find((b) => String(b.id) === k)?.name ?? 'Sin sala', filas: l }));
  }, [visibles, filtro, sucursales]);
  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? null;

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Monitor', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, código o cargo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargarAsistencia?.(2); setAhora(new Date()); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MARCA.verde }} />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`En vivo · ${hora12(ahora)}`}</Text>
        </View>
        <Contadores items={contadores} activo={filtro ?? 'ALL'} onElegir={(id) => setFiltro(id && id !== 'ALL' ? id : null)} />

        {secciones.map((s) => (
          <View key={s.id} style={{ gap: 8 }}>
            <Encabezado>{`${s.titulo} · ${s.filas.length}`}</Encabezado>
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 12, gap: 12 }}>
                  {s.filas.map((f, i) => {
                    const col = columnaDe(f.status);
                    const d = f.scheduleDetails || {};
                    const salaDe = nombreSala(f.e.branchId ?? f.e.branch_id);
                    return (
                      <Pressable key={f.e.id}
                        onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/empleado/[id]', params: { id: String(f.e.id) } }); }}
                        style={({ pressed }) => ({ flexDirection: 'row', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 12 : 0, opacity: pressed ? 0.7 : 1 })}>
                        <View>
                          <Avatar empleado={f.e} tamano={40} />
                          {f.e.hasLactation || d.lactation ? (
                            <View style={{ position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: 8, backgroundColor: '#F472B6', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>L</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={{ flex: 1, gap: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                            <View style={{ flex: 1, gap: 3 }}>
                              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{shortEmployeeName(f.e)}</Text>
                              <PildoraDeCargo cargo={f.e.role} />
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 3 }}>
                              <Pildora texto={ROTULO_ESTADO_ASISTENCIA[f.status] ?? f.status} color={f.status === 'EXTRA_WORKING' ? MARCA.violetaClaro : COLOR[col]} />
                              {f.isLate && f.status !== 'FINISHED' ? <Text style={{ color: MARCA.rojo, fontSize: 11, fontWeight: '700' }}>{f.lateText}</Text> : null}
                            </View>
                          </View>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                            {[d.start ? `${hora12(d.start)} – ${hora12(d.end)}` : f.shiftName,
                              d.lunch ? `almuerzo ${hora12(d.lunch)}` : null,
                              d.lactation ? `lactancia ${hora12(d.lactation)}` : null,
                              !filtro && todas ? salaDe : null].filter(Boolean).join(' · ')}
                          </Text>
                          <Marcas marcas={f.punches} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Vidrio>
            </View>
          </View>
        ))}
        {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Nadie en este grupo</Text> : null}
      </ScrollView>
    </>
  );
}
