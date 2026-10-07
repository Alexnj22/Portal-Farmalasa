// Vacaciones, NATIVO — el plan de vacaciones del año (`VacationPlanView`),
// para mirarlo en el teléfono: quién sale, cuándo, cuántos días y en qué
// estado, mes por mes; cuántos días lleva usados cada persona; y los cambios
// que esperan respuesta. La cuenta de días (un extremo con hora no es un día),
// los días usados y la lista salen del núcleo (`planDeVacaciones`), los mismos
// del portal.
//
// Las solicitudes de cambio se aprueban o rechazan acá (con motivo), con la
// misma acción del portal (`processChangeRequest`). Cada persona lleva su
// saldo del año (15 menos los días usados) y el comentario del plan, y el año
// entero se ve como una línea de tiempo por persona (el Gantt del portal).
// Con la llave de editar el plan: «Asignar vacaciones» (`vacaciones/plan`, con
// la elegibilidad y el saldo del portal) y, manteniendo presionado un plan
// planificado o confirmado, Editar, Confirmar y Cancelar — con las mismas
// funciones del portal (`updateVacationPlanStatus`, `deleteVacationPlan`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
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
import { fallo, listo } from '../componentes/Progreso';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { GanttDelAnio, SolicitudesDeCambio } from '../componentes/personas/Vacaciones';
import Segmentos from '../componentes/Segmentos';

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
  const processChangeRequest = useStaffStore((s) => s.processChangeRequest);
  const updateVacationPlanStatus = useStaffStore((s) => s.updateVacationPlanStatus);
  const deleteVacationPlan = useStaffStore((s) => s.deleteVacationPlan);
  const [vista, setVista] = useState('lista');
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

  const puedeEditar = hasPermission('vacation_plan', 'can_edit');
  // Editar, confirmar o cancelar un plan, como los botones de la fila del
  // portal (sólo planificado o confirmado; confirmar, sólo planificado).
  const acciones = (p) => {
    if (!puedeEditar || !['PLANNED', 'CONFIRMED'].includes(p.status)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const quien = p.employee ? shortEmployeeName(p.employee) : 'esta persona';
    const ops = [['Editar', () => router.push({ pathname: '/vacaciones/plan', params: { id: String(p.id) } })]];
    if (p.status === 'PLANNED') ops.push(['Confirmar', async () => {
      try { await updateVacationPlanStatus(p.id, 'CONFIRMED'); listo('Vacaciones confirmadas', quien); cargar(); }
      catch (e) { fallo('No se pudo confirmar', e?.message || ''); }
    }]);
    ops.push(['Cancelar el plan', () => Alert.alert('Cancelar vacaciones', `Se cancela el plan de ${quien} (${corta(p.start_date)} – ${corta(p.end_date)}).`, [
      { text: 'No', style: 'cancel' },
      { text: 'Cancelar el plan', style: 'destructive', onPress: async () => {
        const ok = await deleteVacationPlan(p.id);
        if (ok) { listo('Plan cancelado', quien); cargar(); } else fallo('No se pudo cancelar el plan', '');
      } },
    ])]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: quien, options: [...ops.map((o) => o[0]), 'Cerrar'], cancelButtonIndex: ops.length, destructiveButtonIndex: ops.length - 1 },
      (i) => { if (i < ops.length) ops[i][1](); },
    );
  };

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
        <SolicitudesDeCambio cambios={(cambios || []).filter((c) => c.status === 'PENDING')} puedeDecidir={hasPermission('vacation_plan', 'can_edit')}
          procesar={processChangeRequest} aprobadorId={user?.id} alTerminar={cargar} />
        <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'lista', label: 'Por mes' }, { id: 'anio', label: 'El año' }]} />
        {vista === 'anio' ? <GanttDelAnio planes={visibles} anio={anio} colorDe={(st) => COLOR_PLAN[st] ?? colorSistema.texto2} /> : null}
        {aproximado && texto ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran nombres parecidos." /></View> : null}
        {cargandoPlanes && !delAnio.length ? <ActivityIndicator style={{ marginTop: 24 }} /> : vista === 'anio' ? null : porMes.map(([mes, lista]) => (
          <View key={mes} style={{ gap: 10 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>
              {`${NOMBRES_DE_MES[mes - 1]} · ${lista.length}`}
            </Text>
            {lista.map((p) => {
              const ahora = p.start_date <= hoy && p.end_date >= hoy && !['CANCELLED', 'DRAFT'].includes(p.status);
              return (
                <Pressable key={p.id} onLongPress={() => acciones(p)} delayLongPress={350} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={20} tinte={ahora ? 'rgba(18,183,106,0.14)' : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                      <Avatar empleado={p.employee ?? { name: '?' }} tamano={40} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.employee ? shortEmployeeName(p.employee) : 'Sin ficha'}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                          {[`${corta(p.start_date)}${p.start_time ? ` ${hora12(p.start_time)}` : ''} – ${corta(p.end_date)}${p.end_time ? ` ${hora12(p.end_time)}` : ''}`, sala === 'ALL' ? p.branch?.name : null].filter(Boolean).join(' · ')}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          <Pildora texto={ESTADO_PLAN[p.status] ?? p.status} color={COLOR_PLAN[p.status] ?? colorSistema.texto2} />
                          {ahora ? <Pildora texto="De vacaciones" color={MARCA.verde} /> : null}
                        </View>
                        {p.notes ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontStyle: 'italic' }}>{`“${p.notes}”`}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{p.days ?? '—'}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>días</Text>
                        {(() => {
                          // El saldo del año: 15 menos lo usado (la cuenta del portal).
                          const usado = usados.get(String(p.employee_id)) || 0;
                          const resta = 15 - usado;
                          return <Text style={{ color: resta < 0 ? MARCA.rojo : resta === 0 ? colorSistema.texto2 : MARCA.verde, fontSize: 11, fontWeight: '700' }}>{`quedan ${resta}`}</Text>;
                        })()}
                      </View>
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}
          </View>
        ))}
        {!cargandoPlanes && !visibles.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {texto ? 'Nadie con esa búsqueda' : `Sin vacaciones planificadas en ${anio}`}
          </Text>
        ) : null}
        {puedeEditar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8, gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionado un plan para editarlo, confirmarlo o cancelarlo.</Text>
            <BotonGrande texto="Asignar vacaciones" color={MARCA.azul}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/vacaciones/plan', params: { anio: String(anio) } }); }} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
