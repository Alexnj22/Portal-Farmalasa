// Horarios, NATIVO — el horario de la semana de una sala (`SchedulesView`),
// pensado para el teléfono: un día a la vez, quién trabaja y de qué hora a qué
// hora, quién descansa y por qué (vacación, incapacidad, permiso, asueto,
// apoyo), y por persona sus horas de la semana contra las 44 del reglamento.
//
// Lo que el portal muestra sobre la grilla también está acá, con la MISMA
// regla del núcleo:
//   · la cobertura del día (`evaluarCoberturaDelDia`): horas de mucha venta con
//     menos de tres personas, y el almuerzo que deja la sala sola o corta;
//   · quién viene de otra sala a cubrir y quién sale a apoyar a otra;
//   · la gráfica de transacciones (`estadisticasDeVentaPorHora`);
//   · «Publicar (N)», con los reparos de la semana (`reparosDeLaSemana`) y la
//     misma acción del store (`publishWeekRosters`).
// La semana de una persona se abre en una hoja, legible. El día de cada uno lo
// resuelve `resolverTurnoDelDia` (un día de horario se resuelve en UN sitio).
//
// Editar (con `schedules` · editar), con las reglas del núcleo
// (`edicionDeHorario`, las mismas del `InlineDayEditor` del portal):
//   · tocar un día en la hoja de una persona lo edita (`guardarDiaDeHorario`,
//     que escribe UN día y NO toca el estado de publicación);
//   · quien viene de otra sala se agrega, se le edita el día o se quita
//     (`upsertScheduleCoverage` / `deleteScheduleCoverage`, que lo anotan);
//   · el catálogo de turnos y los feriados tienen su pantalla
//     (`horarios/turnos`, `horarios/feriados`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { deleteScheduleCoverage, fetchBranchHourlySales, fetchScheduleCoverageAtBranch, fetchScheduleCoverageFromBranch, upsertScheduleCoverage } from '@nucleo/data/schedules';
import { personasDelHorario, personasParaCubrir } from '@nucleo/utils/horarioDeLaSala';
import { resolverTurnoDelDia, HORAS_SEMANA_DIURNA } from '@nucleo/utils/turnoDelDia';
import { calculateEmployeeWeeklyHoursLocal, getDayConflictLocal } from '@nucleo/utils/scheduleHelpers';
import { evaluarCoberturaDelDia } from '@nucleo/utils/coberturaDelDia';
import { estadisticasDeVentaPorHora } from '@nucleo/utils/ventasPorHora';
import { reparosDeLaSemana } from '@nucleo/utils/reparosDeLaSemana';
import { formatWeekRange, getLocalMonday, shiftWeek } from '@nucleo/utils/semana';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { BarraContra, Encabezado, PasoDePeriodo } from '../componentes/personas/Piezas';
import GraficaTx from '../componentes/personas/GraficaTx';
import EditorDeDia from '../componentes/personas/EditorDeDia';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const DIAS = [{ id: 1, corto: 'Lu', largo: 'Lunes' }, { id: 2, corto: 'Ma', largo: 'Martes' }, { id: 3, corto: 'Mi', largo: 'Miércoles' },
  { id: 4, corto: 'Ju', largo: 'Jueves' }, { id: 5, corto: 'Vi', largo: 'Viernes' }, { id: 6, corto: 'Sá', largo: 'Sábado' }, { id: 0, corto: 'Do', largo: 'Domingo' }];
const offset = (id) => (id === 0 ? 6 : id - 1);
const corta = (h) => (hora12(h) || '').replace(':00', '').replace(/\s?a\.\s?m\./, 'a').replace(/\s?p\.\s?m\./, 'p');
const rango = (r) => `${corta(r.inicio)} – ${corta(r.fin)}`;
const COLOR_CONFLICTO = { Vacaciones: MARCA.verde, Incapacidad: MARCA.rojo, Permiso: MARCA.violetaClaro, Asueto: MARCA.azulClaro };
const hace90 = () => sumarDias(hoySV(), -90);

export default function Horarios() {
  const { user, getScope, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const turnos = useStaffStore((s) => s.shifts);
  const fetchWeekRosters = useStaffStore((s) => s.fetchWeekRosters);
  const publishWeekRosters = useStaffStore((s) => s.publishWeekRosters);
  const guardarDiaDeHorario = useStaffStore((s) => s.guardarDiaDeHorario);
  const puedeEditar = !!hasPermission?.('schedules', 'can_edit');
  const todas = getScope?.('schedules') === 'ALL';
  const puedePublicar = !!hasPermission?.('schedules', 'can_edit') && todas;
  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const salaPorDefecto = !todas && user?.branchId ? String(user.branchId)
    : String((salas.find((b) => b.name.toLowerCase().includes('popular')) || salas[0])?.id ?? '');
  const [salaElegida, setSala] = useState(null);
  const sala = salaElegida ?? salaPorDefecto;
  const hoy = hoySV();
  const [lunes, setLunes] = useState(() => getLocalMonday());
  const [dia, setDia] = useState(() => new Date(`${hoy}T12:00:00Z`).getUTCDay());
  const [semana, setSemana] = useState(null);
  const [vienen, setVienen] = useState([]);
  const [salen, setSalen] = useState([]);
  const [stats, setStats] = useState(null);
  const [hoja, setHoja] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  // El día que se está editando: { tipo: 'persona' | 'cobertura', persona, dia, actual, origen }.
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const [busca, setBusca] = useState('');

  const personas = useMemo(() => personasDelHorario(empleados, sala), [empleados, sala]);
  const fechas = useMemo(() => DIAS.map((d) => sumarDias(lunes, offset(d.id))).sort(), [lunes]);

  const cargar = useCallback(async () => {
    if (!sala) return;
    setSemana(null);
    const [sem, at] = await Promise.all([fetchWeekRosters(lunes, sala), fetchScheduleCoverageAtBranch(sala, lunes)]);
    setSemana(sem);
    setVienen(at?.data || []);
    const ids = personas.map((p) => p.id);
    if (ids.length) { const { data } = await fetchScheduleCoverageFromBranch(ids, lunes); setSalen(data || []); } else setSalen([]);
  }, [lunes, sala, fetchWeekRosters, personas]);
  useEffect(() => { cargar(); }, [cargar]);

  // Las ventas de los últimos 3 meses (no cambian con la semana).
  useEffect(() => {
    if (!sala) return undefined;
    let vivo = true;
    setStats(null);
    fetchBranchHourlySales(sala, hace90()).then(({ data }) => {
      if (!vivo) return;
      const suc = (sucursales || []).find((b) => String(b.id) === String(sala));
      setStats(estadisticasDeVentaPorHora(data || [], suc));
    }).catch(() => { if (vivo) setStats({ days: [], generalHours: [], specificHours: {} }); });
    return () => { vivo = false; };
  }, [sala, sucursales]);

  const fecha = sumarDias(lunes, offset(dia));
  const rosterDe = (id) => semana?.rosters?.[id] || {};
  const horasDe = useCallback((p) => calculateEmployeeWeeklyHoursLocal(semana?.rosters?.[p.id] || {}, turnos || [], p.history, fechas), [semana, turnos, fechas]);
  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? 'otra sala';

  const delDia = useMemo(() => personas.map((p) => {
    const apoyo = salen.find((c) => String(c.employee_id) === String(p.id) && Number(c.day_of_week) === dia);
    return {
      p, r: resolverTurnoDelDia(semana?.rosters?.[p.id]?.[String(dia)], turnos || []),
      conflicto: getDayConflictLocal(fecha, p.history),
      apoyo: apoyo ? nombreSala(apoyo.coverage_branch_id) : null,
      publicado: semana?.publishedIds?.has(String(p.id)), tieneHorario: !!semana?.rosters?.[p.id],
    };
  }), [personas, semana, dia, turnos, fecha, salen]); // eslint-disable-line react-hooks/exhaustive-deps
  const trabajan = delDia.filter((x) => x.r.trabaja && !(x.conflicto && x.conflicto.type !== 'SUPPORT')).sort((a, b) => String(a.r.inicio).localeCompare(String(b.r.inicio)));
  const descansan = delDia.filter((x) => !trabajan.includes(x));
  const cubren = useMemo(() => vienen.filter((c) => Number(c.day_of_week) === dia).map((c) => {
    const e = (empleados || []).find((x) => String(x.id) === String(c.employee_id));
    return e ? { e, r: resolverTurnoDelDia(c.schedule_data, turnos || []) } : null;
  }).filter(Boolean), [vienen, dia, empleados, turnos]);
  const cobertura = useMemo(() => {
    if (!semana) return { huecosCriticos: [], avisos: [] };
    const horarios = personas.map((p) => ({ ...rosterDe(p.id), name: shortEmployeeName(p) }));
    return evaluarCoberturaDelDia(dia, horarios, turnos || [], stats?.specificHours?.[dia] || []);
  }, [semana, personas, dia, turnos, stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const publicar = () => {
    const { reparos, porPublicar } = reparosDeLaSemana({ personas, rosters: semana?.rosters || {}, turnos: turnos || [], fechas, publicados: semana?.publishedIds || new Set() });
    const que = porPublicar === 1 ? 'Se publicará 1 horario' : `Se publicarán ${porPublicar} horarios`;
    Alert.alert(reparos.length ? 'La semana tiene reparos' : 'La semana está completa',
      `${reparos.length ? `${reparos.join('\n')}\n\n` : ''}${que} de la semana del ${fechaTexto(lunes, { day: 'numeric', month: 'long' })}.${reparos.length ? ' ¿Publicar de todas formas?' : ''}`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: reparos.length ? 'Publicar con reparos' : 'Publicar horarios', style: reparos.length ? 'destructive' : 'default', onPress: async () => {
          setPublicando(true);
          trabajando('Publicando…');
          try {
            const cuantos = await publishWeekRosters(lunes, sala);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            listo('Horarios publicados', `${cuantos === 1 ? '1 horario' : `${cuantos} horarios`} de la semana.`);
            await cargar();
          } catch (e) { fallo('No se pudieron publicar', mensajeAmigable(e, 'Intenta de nuevo.')); }
          finally { setPublicando(false); }
        } },
      ]);
  };

  // Guardar el día que se editó: el horario de la persona, o su cobertura.
  const guardarEdicion = async (datos) => {
    const ed = editando;
    if (!ed) return;
    setGuardando(true);
    try {
      if (ed.tipo === 'cobertura') {
        const { error } = await upsertScheduleCoverage({
          employee_id: ed.persona.id, coverage_branch_id: Number(sala),
          home_branch_id: ed.origen ? Number(ed.origen) : null, week_start_date: lunes,
          day_of_week: ed.dia, schedule_data: datos, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
      } else {
        await guardarDiaDeHorario(ed.persona.id, lunes, String(ed.dia), datos);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Día guardado', `${shortEmployeeName(ed.persona)} · ${DIAS.find((d) => d.id === ed.dia)?.largo}`);
      setEditando(null);
      await cargar();
    } catch (e) {
      fallo('No se guardó el día', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setGuardando(false); }
  };

  // Quitar a quien viene de otra sala: toda su cobertura de ESTA semana aquí.
  const quitarCobertura = (e) => Alert.alert('Quitar la cobertura',
    `${shortEmployeeName(e)} deja de estar en el horario de ${nombreSala(sala)} la semana del ${fechaTexto(lunes, { day: 'numeric', month: 'long' })}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: async () => {
        const { error } = await deleteScheduleCoverage(e.id, sala, lunes);
        if (error) { fallo('No se quitó la cobertura', mensajeAmigable(error, 'Intenta de nuevo.')); return; }
        listo('Cobertura quitada', shortEmployeeName(e));
        await cargar();
      } },
    ]);
  const coberturaDe = (empId, d) => vienen.find((c) => String(c.employee_id) === String(empId) && Number(c.day_of_week) === d)?.schedule_data;
  const candidatos = useMemo(() => personasParaCubrir(empleados, sala).filter((e) => !busca.trim() || tokenMatch(busca, e.name)), [empleados, sala, busca]);

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: salaPorDefecto, onCambiar: setSala,
    opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : [];
  const nombreDia = DIAS.find((d) => d.id === dia)?.largo;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Horarios', headerLargeTitle: true }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <PasoDePeriodo titulo={formatWeekRange(lunes)} apoyo={lunes !== getLocalMonday() ? 'Toca para volver a esta semana' : 'Esta semana'}
          onTocar={() => { setLunes(getLocalMonday()); setDia(new Date(`${hoy}T12:00:00Z`).getUTCDay()); }}
          onAtras={() => setLunes((l) => shiftWeek(l, -1))} onAdelante={() => setLunes((l) => shiftWeek(l, 1))} />

        <View style={{ flexDirection: 'row', gap: 5, marginHorizontal: 16 }}>
          {DIAS.map((d) => {
            const f = sumarDias(lunes, offset(d.id));
            const activo = d.id === dia;
            const esHoy = f === hoy;
            return (
              <Pressable key={d.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setDia(d.id); }} style={{ flex: 1 }}>
                <Vidrio radio={14} interactivo tinte={activo ? 'rgba(0,82,204,0.55)' : undefined}>
                  <View style={{ alignItems: 'center', paddingVertical: 8, gap: 2 }}>
                    <Text style={{ color: activo ? '#fff' : colorSistema.texto2, fontSize: 11, fontWeight: '700' }}>{d.corto}</Text>
                    <Text style={{ color: activo ? '#fff' : esHoy ? MARCA.azulClaro : colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{Number(f.slice(8))}</Text>
                  </View>
                </Vidrio>
              </Pressable>
            );
          })}
        </View>

        {semana?.fallo ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={semana.fallo} /></View> : null}
        {semana && semana.borradores > 0 ? (
          <View style={{ marginHorizontal: 16, gap: 8 }}>
            <Aviso tono="cuidado" texto={`${semana.borradores} horario${semana.borradores === 1 ? '' : 's'} de esta semana sin publicar.`} />
            {puedePublicar ? <BotonGrande texto={publicando ? 'Publicando…' : `Publicar (${semana.borradores})`} onPress={publicar} deshabilitado={publicando} /> : null}
          </View>
        ) : null}

        {/* La cobertura del día: lo que el portal pinta sobre la columna. */}
        {cobertura.huecosCriticos.length || cobertura.avisos.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18} tinte="rgba(240,68,56,0.10)">
              <View style={{ padding: 12, gap: 6 }}>
                {cobertura.huecosCriticos.length ? (
                  <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '700' }}>
                    {`Menos de 3 personas en horas de mucha venta: ${cobertura.huecosCriticos.map((h) => h.time).join(', ')}`}
                  </Text>
                ) : null}
                {cobertura.avisos.map((a) => (
                  <Text key={a.texto} style={{ color: a.tipo === 'danger' ? MARCA.rojo : MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{a.texto}</Text>
                ))}
              </View>
            </Vidrio>
          </View>
        ) : null}

        {!semana ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            <Encabezado>{`${nombreDia} · trabajan ${trabajan.length}`}</Encabezado>
            {trabajan.map(({ p, r, publicado, apoyo }) => {
              const horas = horasDe(p);
              const dif = Number((horas - HORAS_SEMANA_DIURNA).toFixed(1));
              return (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setHoja(p); }} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={20} interactivo>
                    <View style={{ padding: 14, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Avatar empleado={p} tamano={40} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{shortEmployeeName(p)}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[p.role, r.nombre || (r.esManual ? 'Horario propio' : null)].filter(Boolean).join(' · ')}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 3 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{rango(r)}</Text>
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            {r.esJornadaNocturna ? <Pildora texto="Nocturna" color={MARCA.violeta} /> : null}
                            {!publicado ? <Pildora texto="Borrador" color={MARCA.ambar} /> : null}
                          </View>
                        </View>
                      </View>
                      {r.pausa ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Almuerzo ${hora12(r.pausa.inicio)} · ${r.pausa.minutos} min`}</Text> : null}
                      {apoyo ? <Pildora texto={`Apoya en ${apoyo}`} color={MARCA.azulClaro} /> : null}
                      <View style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row' }}>
                          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12 }}>{`Semana: ${horas} h de ${HORAS_SEMANA_DIURNA}`}</Text>
                          {dif ? <Text style={{ color: dif > 0 ? MARCA.rojo : MARCA.ambar, fontSize: 12, fontWeight: '700' }}>{`${dif > 0 ? '+' : '−'}${Math.abs(dif)} h`}</Text> : <Text style={{ color: MARCA.verde, fontSize: 12, fontWeight: '700' }}>Completa</Text>}
                        </View>
                        <BarraContra valor={horas} meta={HORAS_SEMANA_DIURNA} color={dif > 0 ? MARCA.rojo : dif < 0 ? MARCA.ambar : MARCA.verde} />
                      </View>
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}
            {!trabajan.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>Nadie tiene turno este día.</Text> : null}

            {cubren.length ? (
              <>
                <Encabezado>{`Vienen a cubrir · ${cubren.length}`}</Encabezado>
                <View style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={20} tinte="rgba(59,130,246,0.12)">
                    <View style={{ padding: 14, gap: 10 }}>
                      {cubren.map(({ e, r }) => (
                        <Pressable key={e.id} disabled={!puedeEditar}
                          onPress={() => { Haptics.selectionAsync().catch(() => {}); setEditando({ tipo: 'cobertura', persona: e, dia, actual: coberturaDe(e.id, dia), origen: e.branchId ?? e.branch_id }); }}
                          onLongPress={puedeEditar ? () => quitarCobertura(e) : undefined}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Avatar empleado={e} tamano={32} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`De ${nombreSala(e.branchId ?? e.branch_id)}`}</Text>
                          </View>
                          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{r.trabaja ? rango(r) : '—'}</Text>
                        </Pressable>
                      ))}
                      {puedeEditar ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Toca para editar su día; mantén presionado para quitarla de la semana.</Text> : null}
                    </View>
                  </Vidrio>
                </View>
              </>
            ) : null}

            {descansan.length ? (
              <>
                <Encabezado>{`No trabajan · ${descansan.length}`}</Encabezado>
                <View style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={20}>
                    <View style={{ padding: 14, gap: 10 }}>
                      {descansan.map(({ p, tieneHorario, conflicto, apoyo }) => (
                        <Pressable key={p.id} onPress={() => setHoja(p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Avatar empleado={p} tamano={30} />
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{shortEmployeeName(p)}</Text>
                          {conflicto ? <Pildora texto={conflicto.label} color={COLOR_CONFLICTO[conflicto.label] ?? MARCA.azulClaro} />
                            : apoyo ? <Pildora texto={`Apoya en ${apoyo}`} color={MARCA.azulClaro} />
                              : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{tieneHorario ? 'Libre' : 'Sin horario'}</Text>}
                        </Pressable>
                      ))}
                    </View>
                  </Vidrio>
                </View>
              </>
            ) : null}
          </>
        )}

        <GraficaTx stats={stats} dia={dia} nombreDelDia={nombreDia} />

        {puedeEditar && semana ? (
          <View style={{ marginHorizontal: 16, gap: 10, marginTop: 4 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Toca a una persona y luego un día para editarlo.</Text>
            <BotonGrande texto="Agregar quien viene a cubrir" borde color={MARCA.azulClaro} onPress={() => { setBusca(''); setEligiendo(true); }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Turnos" borde color={MARCA.violetaClaro} onPress={() => router.push('/horarios/turnos')} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto="Feriados" borde color={MARCA.violetaClaro} onPress={() => router.push('/horarios/feriados')} /></View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* La semana de una persona, legible: un renglón por día. */}
      <Modal visible={!!hoja || !!editando} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (editando) setEditando(null); else setHoja(null); }}>
        {editando ? (
          <ConAurora>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
              <Pressable onPress={() => setEditando(null)} hitSlop={10}><Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '600' }}>{hoja ? '‹ Semana' : 'Cancelar'}</Text></Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{shortEmployeeName(editando.persona)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{editando.tipo === 'cobertura' ? `Cubre en ${nombreSala(sala)}` : DIAS.find((d) => d.id === editando.dia)?.largo}</Text>
              </View>
              <View style={{ width: 70 }} />
            </View>
            {editando.tipo === 'cobertura' ? (
              <View style={{ flexDirection: 'row', gap: 5, marginHorizontal: 16 }}>
                {DIAS.map((d) => (
                  <Pressable key={d.id} onPress={() => setEditando((x) => ({ ...x, dia: d.id, actual: coberturaDe(x.persona.id, d.id) }))} style={{ flex: 1 }}>
                    <Vidrio radio={12} interactivo tinte={d.id === editando.dia ? 'rgba(0,82,204,0.55)' : undefined}>
                      <Text style={{ textAlign: 'center', paddingVertical: 8, color: d.id === editando.dia ? '#fff' : colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{d.corto}</Text>
                    </Vidrio>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <EditorDeDia key={`${editando.persona.id}-${editando.dia}`} fecha={sumarDias(lunes, offset(editando.dia))} dia={editando.dia}
              actual={editando.actual} turnos={turnos || []} sala={(sucursales || []).find((b) => String(b.id) === String(sala))}
              guardando={guardando} onGuardar={guardarEdicion}
              aviso={semana?.publishedIds?.has(String(editando.persona.id)) ? 'La semana ya está publicada: el cambio se ve en el kiosco y en la planilla en cuanto lo guardes.' : null} />
          </ConAurora>
        ) : hoja ? (
          <ConAurora>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
              <Avatar empleado={hoja} tamano={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{shortEmployeeName(hoja)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatWeekRange(lunes)} · ${horasDe(hoja)} h de ${HORAS_SEMANA_DIURNA}`}</Text>
              </View>
              <Pressable onPress={() => setHoja(null)} hitSlop={10}><Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '600' }}>Listo</Text></Pressable>
            </View>
            {puedeEditar ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Toca un día para cambiarlo.</Text> : null}
            <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
              {DIAS.map((d) => {
                const f = sumarDias(lunes, offset(d.id));
                const rd = resolverTurnoDelDia(rosterDe(hoja.id)[String(d.id)], turnos || []);
                const cf = getDayConflictLocal(f, hoja.history);
                return (
                  <Pressable key={d.id} disabled={!puedeEditar}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); setEditando({ tipo: 'persona', persona: hoja, dia: d.id, actual: rosterDe(hoja.id)[String(d.id)] }); }}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={16} interactivo={puedeEditar} tinte={d.id === dia ? 'rgba(0,82,204,0.25)' : undefined}>
                    <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 92 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{d.largo}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaTexto(f, { day: 'numeric', month: 'short' })}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: rd.trabaja ? colorSistema.texto : colorSistema.texto2, fontSize: 16, fontWeight: '700' }}>{rd.trabaja ? rango(rd) : 'Libre'}</Text>
                        {rd.trabaja ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[rd.nombre || (rd.esManual ? 'Horario propio' : null), rd.pausa ? `almuerzo ${hora12(rd.pausa.inicio)}` : null].filter(Boolean).join(' · ')}</Text> : null}
                      </View>
                      {cf ? <Pildora texto={cf.label} color={COLOR_CONFLICTO[cf.label] ?? MARCA.azulClaro} /> : null}
                      {puedeEditar ? <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text> : null}
                    </View>
                  </Vidrio>
                  </Pressable>
                );
              })}
            </ScrollView>
          </ConAurora>
        ) : null}
      </Modal>

      {/* Agregar a alguien de otra sala: se elige y se le edita el día. */}
      <Modal visible={eligiendo} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEligiendo(false)}>
        <ConAurora>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{`Viene a cubrir a ${nombreSala(sala)}`}</Text>
            <Pressable onPress={() => setEligiendo(false)} hitSlop={10}><Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '600' }}>Cancelar</Text></Pressable>
          </View>
          <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar persona" placeholderTextColor={colorSistema.texto2} autoCorrect={false}
            style={{ marginHorizontal: 16, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {candidatos.map((e) => (
              <Pressable key={e.id} onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setEligiendo(false);
                setEditando({ tipo: 'cobertura', persona: e, dia, actual: coberturaDe(e.id, dia), origen: e.branchId ?? e.branch_id });
              }}>
                <Vidrio radio={16} interactivo>
                  <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={e} tamano={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[e.role, nombreSala(e.branchId ?? e.branch_id)].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </View>
                </Vidrio>
              </Pressable>
            ))}
            {!candidatos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center', marginTop: 20 }}>Nadie con ese nombre en otras salas.</Text> : null}
          </ScrollView>
        </ConAurora>
      </Modal>
    </>
  );
}
