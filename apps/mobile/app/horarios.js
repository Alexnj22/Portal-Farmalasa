// Horarios, NATIVO — el horario de la semana de una sala (la pestaña
// «Horarios» de `SchedulesView`), pensado para mirarlo en el teléfono: un día a
// la vez, quién trabaja y de qué hora a qué hora, quién descansa, y la semana
// de cada persona al tocarla. Se cambia de semana con las flechas.
//
// El día de cada persona lo resuelve `resolverTurnoDelDia` (el MISMO que usan
// la planilla, el kiosco y los avisos de sala: un día de horario se resuelve en
// un solo sitio). La gente y su orden salen de `personasDelHorario`. Editar el
// horario se hace en el portal (dentro de la app): la grilla de la semana no
// cabe en un teléfono.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { personasDelHorario } from '@nucleo/utils/horarioDeLaSala';
import { resolverTurnoDelDia } from '@nucleo/utils/turnoDelDia';
import { formatWeekRange, getLocalMonday, shiftWeek } from '@nucleo/utils/semana';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const DIAS = [{ id: 1, corto: 'Lu' }, { id: 2, corto: 'Ma' }, { id: 3, corto: 'Mi' }, { id: 4, corto: 'Ju' }, { id: 5, corto: 'Vi' }, { id: 6, corto: 'Sá' }, { id: 0, corto: 'Do' }];
const offset = (id) => (id === 0 ? 6 : id - 1);
// «7:00 a. m.» → «7a», «1:30 p. m.» → «1:30p»: lo que cabe junto a un nombre.
const corta = (h) => (hora12(h) || '').replace(':00', '').replace(/\s?a\.\s?m\./, 'a').replace(/\s?p\.\s?m\./, 'p');
const rango = (r) => `${corta(r.inicio)} – ${corta(r.fin)}`;

function Flecha({ texto, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 26, fontWeight: '300' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Horarios() {
  const { user, getScope, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const turnos = useStaffStore((s) => s.shifts);
  const fetchWeekRosters = useStaffStore((s) => s.fetchWeekRosters);
  const todas = getScope?.('schedules') === 'ALL';
  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const salaPorDefecto = !todas && user?.branchId ? String(user.branchId)
    : String((salas.find((b) => b.name.toLowerCase().includes('popular')) || salas[0])?.id ?? '');
  const [salaElegida, setSala] = useState(null);
  const sala = salaElegida ?? salaPorDefecto;
  const hoy = hoySV();
  const [lunes, setLunes] = useState(() => getLocalMonday());
  const [dia, setDia] = useState(() => new Date(`${hoy}T12:00:00Z`).getUTCDay());
  const [semana, setSemana] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala) return;
    setSemana(null);
    setSemana(await fetchWeekRosters(lunes, sala));
  }, [lunes, sala, fetchWeekRosters]);
  useEffect(() => { cargar(); }, [cargar]);

  const personas = useMemo(() => personasDelHorario(empleados, sala), [empleados, sala]);
  const fecha = sumarDias(lunes, offset(dia));
  const delDia = useMemo(() => personas.map((p) => ({
    p, r: resolverTurnoDelDia(semana?.rosters?.[p.id]?.[String(dia)], turnos || []),
    publicado: semana?.publishedIds?.has(String(p.id)), tieneHorario: !!semana?.rosters?.[p.id],
  })), [personas, semana, dia, turnos]);
  const trabajan = delDia.filter((x) => x.r.trabaja).sort((a, b) => String(a.r.inicio).localeCompare(String(b.r.inicio)));
  const descansan = delDia.filter((x) => !x.r.trabaja);

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: salaPorDefecto, onCambiar: setSala,
    opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Horarios', headerLargeTitle: true }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12 }}>
          <Flecha texto="‹" onPress={() => setLunes((l) => shiftWeek(l, -1))} />
          <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={() => { setLunes(getLocalMonday()); setDia(new Date(`${hoy}T12:00:00Z`).getUTCDay()); }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{formatWeekRange(lunes)}</Text>
            {lunes !== getLocalMonday() ? <Text style={{ color: MARCA.azulClaro, fontSize: 12 }}>Volver a esta semana</Text> : null}
          </Pressable>
          <Flecha texto="›" onPress={() => setLunes((l) => shiftWeek(l, 1))} />
        </View>

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
        {semana && semana.borradores > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${semana.borradores} horario${semana.borradores === 1 ? '' : 's'} de esta semana sin publicar.`} /></View> : null}
        {!semana ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20 }}>
              {`Trabajan · ${trabajan.length}`}
            </Text>
            {trabajan.map(({ p, r, publicado }) => (
              <Pressable key={p.id} onPress={() => setAbierto(abierto === p.id ? null : p.id)} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                <Vidrio radio={20} interactivo>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Avatar empleado={p} tamano={40} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{shortEmployeeName(p)}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{[p.role, r.nombre || (r.esManual ? 'Horario propio' : null)].filter(Boolean).join(' · ')}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 3 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{rango(r)}</Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {r.esJornadaNocturna ? <Pildora texto="Nocturna" color={MARCA.violeta} /> : null}
                          {!publicado ? <Pildora texto="Borrador" color={MARCA.ambar} /> : null}
                        </View>
                      </View>
                    </View>
                    {r.pausa ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Pausa ${hora12(r.pausa.inicio)} · ${r.pausa.minutos} min`}</Text> : null}
                    {abierto === p.id ? (
                      <View style={{ flexDirection: 'row', gap: 4, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                        {DIAS.map((d) => {
                          const rd = resolverTurnoDelDia(semana?.rosters?.[p.id]?.[String(d.id)], turnos || []);
                          return (
                            <View key={d.id} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                              <Text style={{ color: d.id === dia ? MARCA.azulClaro : colorSistema.texto2, fontSize: 11, fontWeight: '700' }}>{d.corto}</Text>
                              <Text style={{ color: rd.trabaja ? colorSistema.texto : colorSistema.texto2, fontSize: 10, textAlign: 'center' }}>
                                {rd.trabaja ? `${corta(rd.inicio)}\n${corta(rd.fin)}` : 'Libre'}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                </Vidrio>
              </Pressable>
            ))}
            {!trabajan.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>Nadie tiene turno este día.</Text> : null}

            {descansan.length ? (
              <>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 6 }}>
                  {`Descansan · ${descansan.length}`}
                </Text>
                <View style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={20}>
                    <View style={{ padding: 14, gap: 10 }}>
                      {descansan.map(({ p, tieneHorario }) => (
                        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Avatar empleado={p} tamano={28} />
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{shortEmployeeName(p)}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{tieneHorario ? 'Libre' : 'Sin horario'}</Text>
                        </View>
                      ))}
                    </View>
                  </Vidrio>
                </View>
              </>
            ) : null}
          </>
        )}

        {hasPermission('schedules', 'can_edit') ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Editar el horario (portal)" borde color={MARCA.azulClaro}
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/horarios', nombre: 'Horarios' } })} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
