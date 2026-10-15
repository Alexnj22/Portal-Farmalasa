// El catálogo de turnos, NATIVO — la pestaña «Catálogo» de Horarios del portal
// (`TabShifts`). Activos y archivados, cada turno con sus horas y su pausa;
// crear, editar, duplicar, archivar y reactivar con las MISMAS acciones del
// store (`addShift`, `updateShift`, `archiveShift`, `unarchiveShift`), que
// anotan en la bitácora.
//
// La agrupación (nombre + horas: puede haber varias filas iguales) y la
// revisión del turno (nombre automático, reglamento, repetidos) son del núcleo
// (`edicionDeHorario`), las mismas del portal. Editar un grupo edita TODAS sus
// filas, como el portal: editar sólo la primera dejaba a las demás con las horas
// viejas e invisibles.
//
// Cambiarle la hora a un turno mueve el horario de todos los que lo usan; por
// eso guardar una edición pide confirmación.
//
// Arriba, como el portal, lo que le falta al catálogo contra el horario de cada
// sala (`sugerenciasDelCatalogo`, núcleo): «Crear este turno» abre el formulario
// con esas horas e «Ignorar» lo esconde hasta salir de la pantalla.
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Interruptor from '../../componentes/Interruptor';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { gruposDelCatalogo, revisionDelTurno, sugerenciasDelCatalogo } from '@nucleo/utils/edicionDeHorario';
import { MINUTOS_DE_PAUSA } from '@nucleo/utils/turnoDelDia';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../../componentes/Segmentos';
import { MenuDeFiltros } from '../../componentes/Filtros';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import Vidrio from '../../componentes/Vidrio';
import ConAurora from '../../componentes/ConAurora';
import { MARCA } from '../../componentes/inicio/marca';
import Hora from '../../componentes/personas/Hora';
import { fallo, listo } from '../../componentes/Progreso';

const VACIO = { start: '07:00', end: '16:00', name: '', lunchStart: '', lunchMinutes: MINUTOS_DE_PAUSA };

export default function Turnos() {
  const { hasPermission } = useAuth();
  const puedeEditar = !!hasPermission?.('schedules', 'can_edit');
  const turnos = useStaffStore((s) => s.shifts);
  const sucursales = useStaffStore((s) => s.branches);
  const [ignoradas, setIgnoradas] = useState(() => new Set());
  const addShift = useStaffStore((s) => s.addShift);
  const updateShift = useStaffStore((s) => s.updateShift);
  const archiveShift = useStaffStore((s) => s.archiveShift);
  const unarchiveShift = useStaffStore((s) => s.unarchiveShift);
  const [pestana, setPestana] = useState('activos');
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState(null); // { ...campos, grupo } — grupo = el que se edita
  const [guardando, setGuardando] = useState(false);

  const grupos = useMemo(() => gruposDelCatalogo(turnos, { archivados: pestana === 'archivados', busqueda: busca }), [turnos, pestana, busca]);
  const sugerencias = useMemo(() => sugerenciasDelCatalogo(turnos, sucursales, ignoradas), [turnos, sucursales, ignoradas]);
  const crearSugerido = (accion) => {
    Haptics.selectionAsync().catch(() => {});
    setForm({ ...VACIO, start: accion.start, end: accion.end, grupo: null });
    listo('Sugerencia aplicada', 'Revisa las horas y guarda el turno.');
  };
  const revision = useMemo(() => (form ? revisionDelTurno(form, turnos, form.grupo) : null), [form, turnos]);
  const cambiar = (k) => (v) => setForm((x) => ({ ...x, [k]: v }));

  const abrirNuevo = () => { Haptics.selectionAsync().catch(() => {}); setForm({ ...VACIO, grupo: null }); };
  const abrirEditar = (g) => setForm({ start: g.start, end: g.end, name: g.name, lunchStart: g.lunchStart || '', lunchMinutes: g.lunchMinutes ?? MINUTOS_DE_PAUSA, grupo: g });
  const duplicar = (g) => { setForm({ start: g.start, end: g.end, name: g.name, lunchStart: g.lunchStart || '', lunchMinutes: g.lunchMinutes ?? MINUTOS_DE_PAUSA, grupo: null }); listo('Copia del turno', 'Cámbiale las horas o el nombre y guárdalo.'); };

  const archivar = (g, archivado) => Alert.alert(archivado ? 'Reactivar el turno' : 'Archivar el turno',
    archivado ? `«${g.name}» vuelve al catálogo y se puede asignar.` : `«${g.name}» sale del catálogo: ya no se ofrece al asignar. Los días que ya lo tienen no cambian.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: archivado ? 'Reactivar' : 'Archivar', style: archivado ? 'default' : 'destructive', onPress: async () => {
        try {
          for (const id of g.all_ids) await (archivado ? unarchiveShift(id) : archiveShift(id));
          listo(archivado ? 'Turno reactivado' : 'Turno archivado', g.name);
        } catch (e) { fallo('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.')); }
      } },
    ]);

  const menu = (g) => {
    if (!puedeEditar) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const archivado = pestana === 'archivados';
    const opciones = archivado ? ['Reactivar', 'Cancelar'] : ['Editar', 'Duplicar', 'Archivar', 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({
      title: `${g.name} · ${hora12(g.start)} – ${hora12(g.end)}`, options: opciones,
      cancelButtonIndex: opciones.length - 1, destructiveButtonIndex: archivado ? undefined : 2,
    }, (i) => {
      if (archivado) { if (i === 0) archivar(g, true); return; }
      if (i === 0) abrirEditar(g); else if (i === 1) duplicar(g); else if (i === 2) archivar(g, false);
    });
  };

  const guardar = async () => {
    if (!form || revision?.hasBlockingError) return;
    const nombre = form.name.trim() || revision.autoName;
    const escribir = async () => {
      setGuardando(true);
      try {
        if (form.grupo) {
          const parche = {
            name: nombre, start_time: `${form.start}:00`, end_time: `${form.end}:00`, branch_id: null,
            lunch_start: form.lunchStart ? `${form.lunchStart}:00` : null, lunch_minutes: form.lunchMinutes ?? MINUTOS_DE_PAUSA,
          };
          for (const id of form.grupo.all_ids) await updateShift(id, parche);
          listo('Turno actualizado', `«${nombre}» quedó guardado.`);
        } else {
          await addShift({ name: nombre, start: form.start, end: form.end, branchId: null, lunchStart: form.lunchStart || null, lunchMinutes: form.lunchMinutes ?? MINUTOS_DE_PAUSA });
          listo('Turno creado', `«${nombre}» ya se puede asignar.`);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setForm(null);
      } catch (e) { fallo('No se guardó el turno', mensajeAmigable(e, 'Verifica tu conexión.')); }
      finally { setGuardando(false); }
    };
    if (form.grupo) {
      Alert.alert('Cambiar el turno', `Cambiar «${form.grupo.name}» mueve el horario de todos los días que ya lo usan.`, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: escribir },
      ]);
    } else escribir();
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Turnos', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Buscar turno', hideWhenScrolling: false, onChangeText: (e) => setBusca(e.nativeEvent.text), onCancelButtonPress: () => setBusca('') },
      }} />
      <MenuDeFiltros grupos={[]} extra={puedeEditar ? { icono: 'plus', etiqueta: 'Nuevo turno', onPress: abrirNuevo } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'activos', label: 'Activos' }, { id: 'archivados', label: 'Archivados' }]} />
        {pestana === 'activos' && !busca ? sugerencias.map((sg) => {
          const error = sg.type === 'error';
          const color = error ? MARCA.rojo : MARCA.violetaClaro;
          return (
            <View key={sg.key} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} tinte={error ? 'rgba(240,68,56,0.12)' : 'rgba(105,41,196,0.14)'}>
                <View style={{ padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>{error ? 'Falta un dato' : 'Sugerencia'}</Text>
                    <Pressable onPress={() => setIgnoradas((prev) => new Set(prev).add(sg.key))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Ignorar aviso"
                      style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>Ignorar</Text>
                    </Pressable>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{sg.branch}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{sg.text}</Text>
                  {sg.action && puedeEditar ? (
                    <Pressable onPress={() => crearSugerido(sg.action)} accessibilityRole="button"
                      style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center', backgroundColor: `${color}2E`, opacity: pressed ? 0.7 : 1 })}>
                      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{`Crear este turno · ${hora12(sg.action.start)} – ${hora12(sg.action.end)}`}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Vidrio>
            </View>
          );
        }) : null}
        {grupos.map((g) => (
          <Pressable key={g.groupId} onPress={() => (pestana === 'activos' && puedeEditar ? abrirEditar(g) : menu(g))} onLongPress={() => menu(g)} delayLongPress={350}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{g.name}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[g.lunchStart ? `almuerzo ${hora12(g.lunchStart)} · ${g.lunchMinutes} min` : 'sin pausa', g.all_ids.length > 1 ? `${g.all_ids.length} filas` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${hora12(g.start)} – ${hora12(g.end)}`}</Text>
              </View>
            </Vidrio>
          </Pressable>
        ))}
        {!grupos.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 32 }}>{pestana === 'activos' ? 'El catálogo está vacío' : 'Ningún turno archivado'}</Text> : null}
        {puedeEditar && grupos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center', marginHorizontal: 24 }}>Mantén presionado un turno para duplicarlo, archivarlo o reactivarlo.</Text> : null}
      </ScrollView>

      <Modal visible={!!form} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setForm(null)}>
        {form ? (
          <ConAurora>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <Pressable onPress={() => setForm(null)} hitSlop={10}><Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '600' }}>Cancelar</Text></Pressable>
                <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{form.grupo ? 'Editar turno' : 'Nuevo turno'}</Text>
                <View style={{ width: 70 }} />
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
                <Seccion titulo="Nombre" pie={`Si lo dejas vacío se llama «${revision?.autoName}».`}>
                  <TextInput value={form.name} onChangeText={cambiar('name')} placeholder={revision?.autoName} placeholderTextColor={colorSistema.texto2} maxLength={60}
                    style={{ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
                </Seccion>
                <Seccion titulo="Horas">
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Entra</Text><Hora valor={form.start} onCambiar={cambiar('start')} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Sale</Text><Hora valor={form.end} onCambiar={cambiar('end')} />
                  </View>
                </Seccion>
                <Seccion pie="La pausa la heredan los días al asignar el turno.">
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{`Almuerzo (${form.lunchMinutes ?? MINUTOS_DE_PAUSA} min)`}</Text>
                    <Interruptor value={!!form.lunchStart} onValueChange={(v) => cambiar('lunchStart')(v ? '12:00' : '')} />
                  </View>
                  {form.lunchStart ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Sale a almorzar</Text><Hora valor={form.lunchStart} onCambiar={cambiar('lunchStart')} />
                    </View>
                  ) : null}
                </Seccion>
                {(revision?.activeAlerts || []).map((a) => <Aviso key={a.text} tono={a.type === 'error' ? 'freno' : 'cuidado'} texto={a.text} />)}
                <BotonGrande texto={guardando ? 'Guardando…' : form.grupo ? 'Guardar cambios' : 'Crear turno'} onPress={guardar}
                  deshabilitado={guardando || !form.start || !form.end || revision?.hasBlockingError} />
              </ScrollView>
            </KeyboardAvoidingView>
          </ConAurora>
        ) : null}
      </Modal>
    </>
  );
}
