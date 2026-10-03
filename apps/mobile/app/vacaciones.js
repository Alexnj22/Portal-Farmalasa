// Vacaciones, NATIVO — el plan de vacaciones del año (`VacationPlanView`),
// para mirarlo en el teléfono: quién sale, cuándo, cuántos días y en qué
// estado, mes por mes; cuántos días lleva usados cada persona; y los cambios
// que esperan respuesta. La cuenta de días (un extremo con hora no es un día),
// los días usados y la lista salen del núcleo (`planDeVacaciones`), los mismos
// del portal.
//
// Asignar, aprobar o responder un cambio se hace en el portal (dentro de la
// app): el formulario de asignación revisa elegibilidad, feriados y saldo, y
// no se repite acá.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { diasUsadosPorPersona, ESTADO_PLAN, planesVisibles } from '@nucleo/utils/planDeVacaciones';
import { fechaTexto, hoySV, NOMBRES_DE_MES } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLOR_PLAN = { DRAFT: colorSistema.texto2, PRE_APPROVED: MARCA.azulClaro, CHANGE_REQUESTED: MARCA.ambar, APPROVED: MARCA.verde,
  PLANNED: MARCA.azulClaro, CONFIRMED: MARCA.verde, TAKEN: colorSistema.texto2, CANCELLED: MARCA.rojo };
const corta = (f) => fechaTexto(f, { day: 'numeric', month: 'short' });

export default function Vacaciones() {
  const { user, getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const planes = useStaffStore((s) => s.vacationPlans);
  const cargandoPlanes = useStaffStore((s) => s.isLoadingVacationPlans);
  const cambios = useStaffStore((s) => s.vacationChangeRequests);
  const fetchVacationPlans = useStaffStore((s) => s.fetchVacationPlans);
  const fetchVacationChangeRequests = useStaffStore((s) => s.fetchVacationChangeRequests);
  const todas = getScope?.('vacation_plan') === 'ALL';
  const anioActual = Number(hoySV().slice(0, 4));
  const [anio, setAnio] = useState(anioActual);
  const [salaElegida, setSala] = useState('ALL');
  const [estado, setEstado] = useState('ALL');
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);
  const sala = todas ? salaElegida : String(user?.branchId || '');

  const cargar = useCallback(async () => {
    await Promise.all([fetchVacationPlans(anio, sala === 'ALL' ? null : sala), fetchVacationChangeRequests(anio)]);
  }, [anio, sala, fetchVacationPlans, fetchVacationChangeRequests]);
  useEffect(() => { cargar(); }, [cargar]);

  const delAnio = useMemo(() => (planes || []).filter((p) => p.year === anio), [planes, anio]);
  const usados = useMemo(() => diasUsadosPorPersona(delAnio, anio), [delAnio, anio]);
  const { planes: visibles, aproximado } = useMemo(() => planesVisibles(delAnio, { estado, busqueda: texto }), [delAnio, estado, texto]);
  // Por mes de inicio, en orden de calendario.
  const porMes = useMemo(() => {
    const m = new Map();
    for (const p of [...visibles].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))) {
      const k = Number(String(p.start_date).slice(5, 7));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return [...m.entries()];
  }, [visibles]);
  const hoy = hoySV();
  const fuera = delAnio.filter((p) => !['CANCELLED', 'DRAFT'].includes(p.status) && p.start_date <= hoy && p.end_date >= hoy).length;
  const cambiosPendientes = (cambios || []).filter((c) => c.status === 'PENDING').length;

  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const grupos = [
    { id: 'anio', titulo: 'Año', activa: String(anio), porDefecto: String(anioActual), onCambiar: (v) => setAnio(Number(v)),
      opciones: [anioActual + 1, anioActual, anioActual - 1].map((a) => ({ id: String(a), label: String(a) })) },
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'ALL', onCambiar: setEstado,
      opciones: [{ id: 'ALL', label: 'Todos' }, ...Object.entries(ESTADO_PLAN).map(([k, l]) => ({ id: k, label: l }))] },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
      opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...salas.map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Vacaciones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre o sala', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <FilaDeKpis>
          <Kpi icono="Palmtree" rotulo={`Planes ${anio}`} valor={String(delAnio.filter((p) => p.status !== 'CANCELLED').length)} color={MARCA.verde}
            apoyo={anio === anioActual ? `${fuera} de vacaciones hoy` : null} />
          <Kpi icono="RefreshCw" rotulo="Cambios pedidos" valor={String(cambiosPendientes)} color={cambiosPendientes ? MARCA.ambar : MARCA.azul}
            apoyo={cambiosPendientes ? 'esperan respuesta' : 'ninguno pendiente'} />
        </FilaDeKpis>
        {aproximado && texto ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran nombres parecidos." /></View> : null}
        {cargandoPlanes && !delAnio.length ? <ActivityIndicator style={{ marginTop: 24 }} /> : porMes.map(([mes, lista]) => (
          <View key={mes} style={{ gap: 10 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>
              {`${NOMBRES_DE_MES[mes - 1]} · ${lista.length}`}
            </Text>
            {lista.map((p) => {
              const ahora = p.start_date <= hoy && p.end_date >= hoy && !['CANCELLED', 'DRAFT'].includes(p.status);
              return (
                <View key={p.id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={20} tinte={ahora ? 'rgba(18,183,106,0.14)' : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                      <Avatar empleado={p.employee ?? { name: '?' }} tamano={40} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.employee ? shortEmployeeName(p.employee) : 'Sin ficha'}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                          {[`${corta(p.start_date)}${p.start_time ? ` ${hora12(p.start_time)}` : ''} – ${corta(p.end_date)}${p.end_time ? ` ${hora12(p.end_time)}` : ''}`, sala === 'ALL' ? p.branch?.name : null].filter(Boolean).join(' · ')}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          <Pildora texto={ESTADO_PLAN[p.status] ?? p.status} color={COLOR_PLAN[p.status] ?? colorSistema.texto2} />
                          {ahora ? <Pildora texto="De vacaciones" color={MARCA.verde} /> : null}
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{p.days ?? '—'}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`días · usó ${usados.get(String(p.employee_id)) || 0}`}</Text>
                      </View>
                    </View>
                  </Vidrio>
                </View>
              );
            })}
          </View>
        ))}
        {!cargandoPlanes && !visibles.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {texto ? 'Nadie con esa búsqueda' : `Sin vacaciones planificadas en ${anio}`}
          </Text>
        ) : null}
        {hasPermission('vacation_plan', 'can_edit') ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Asignar o aprobar (portal)" borde color={MARCA.azulClaro}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/portal', params: { ruta: '/vacaciones', nombre: 'Vacaciones' } }); }} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
