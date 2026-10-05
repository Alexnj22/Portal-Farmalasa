// Monitor en tiempo real, NATIVO — `AttendanceMonitorView`: quién está
// trabajando, en pausa, sin marcar o ya terminó, ahora mismo, y quién llegó
// tarde y cuánto. Se refresca solo cada minuto.
//
// El estado de cada persona sale del núcleo (`estadoDeAsistencia`), el mismo
// cálculo del portal; las marcaciones, de `loadAttendanceLastDays`.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { COLUMNAS_DE_ASISTENCIA, compararAsistencia, estadoDeAsistencia, ROTULO_ESTADO_ASISTENCIA } from '@nucleo/utils/estadoDeAsistencia';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { ordenDeSala } from '@nucleo/constants/erp';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLOR = { working: MARCA.verde, pause: MARCA.ambar, pending: colorSistema.texto2, finished: MARCA.azulClaro };
const columnaDe = (estado) => COLUMNAS_DE_ASISTENCIA.find((c) => c.estados.includes(estado))?.id ?? 'pending';

export default function Monitor() {
  const { user, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const turnos = useStaffStore((s) => s.shifts);
  const cargarAsistencia = useStaffStore((s) => s.loadAttendanceLastDays);
  const todas = getScope?.('monitor') === 'ALL';
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? salaElegida : String(user?.branchId ?? '');
  const [columna, setColumna] = useState('todas');
  const [texto, setTexto] = useState('');
  const [ahora, setAhora] = useState(() => new Date());
  const [recargando, setRecargando] = useState(false);

  useEffect(() => { cargarAsistencia?.(2); }, [cargarAsistencia]);
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 60_000); return () => clearInterval(t); }, []);

  const filas = useMemo(() => (empleados || [])
    .filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO')
    .filter((e) => sala === 'ALL' || String(e.branchId ?? e.branch_id) === sala)
    .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.name, e.code, e.role))
    .map((e) => ({ e, ...estadoDeAsistencia(e, turnos || [], ahora) })), [empleados, turnos, ahora, sala, texto]);

  const cuenta = (id) => filas.filter((f) => columnaDe(f.status) === id).length;
  const tarde = filas.filter((f) => f.isLate && f.status !== 'FINISHED').length;
  const visibles = filas.filter((f) => (columna === 'todas' ? true : columna === 'tarde' ? (f.isLate && f.status !== 'FINISHED') : columnaDe(f.status) === columna));
  const porSala = useMemo(() => {
    const m = new Map();
    for (const f of [...visibles].sort(compararAsistencia)) { const k = String(f.e.branchId ?? f.e.branch_id); if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
    return [...m.entries()].sort((a, b) => ordenDeSala(Number(a[0])) - ordenDeSala(Number(b[0])));
  }, [visibles]);
  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === id)?.name ?? 'Sin sala';
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargarAsistencia?.(2); setAhora(new Date()); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <FilaDeKpis>
          <Kpi icono="Users" rotulo="Trabajando" valor={String(cuenta('working'))} color={MARCA.verde} apoyo={`${cuenta('pause')} en pausa`} />
          <Kpi icono="Clock" rotulo="Sin marcar" valor={String(cuenta('pending'))} color={cuenta('pending') ? MARCA.ambar : MARCA.verde} apoyo={tarde ? `${tarde} llegaron tarde` : 'nadie tarde'} />
        </FilaDeKpis>
        <Segmentos activa={columna} onCambiar={setColumna} opciones={[
          { id: 'todas', label: 'Todos' }, { id: 'working', label: 'Trabajando' }, { id: 'pending', label: 'Sin marcar' }, { id: 'tarde', label: tarde ? `Tarde · ${tarde}` : 'Tarde' },
        ]} />
        {porSala.map(([idSala, lista]) => (
          <View key={idSala} style={{ gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>{`${nombreSala(idSala)} · ${lista.length}`}</Text>
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 12, gap: 10 }}>
                  {lista.map((f, i) => {
                    const col = columnaDe(f.status);
                    return (
                      <Pressable key={f.e.id} onPress={() => router.push({ pathname: '/portal', params: { ruta: `/personal?empleado=${f.e.id}`, nombre: 'Personal' } })}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                        <Avatar empleado={f.e} tamano={36} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(f.e)}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                            {[f.scheduleDetails.start ? `${hora12(f.scheduleDetails.start)} – ${hora12(f.scheduleDetails.end)}` : f.shiftName, f.lastActionTime ? `última ${f.lastActionTime}` : null].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 3 }}>
                          <Pildora texto={ROTULO_ESTADO_ASISTENCIA[f.status] ?? f.status} color={COLOR[col]} />
                          {f.isLate && f.status !== 'FINISHED' ? <Text style={{ color: MARCA.rojo, fontSize: 11, fontWeight: '700' }}>{f.lateText}</Text> : null}
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
