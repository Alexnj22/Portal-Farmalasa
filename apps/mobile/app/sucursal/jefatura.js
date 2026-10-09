// Asignar la jefatura o la subjefatura de una sala que no la tiene, NATIVO —
// `FormLeadership` del portal (el diálogo que abre la tarjeta «Sin Jefe/a» de
// la ficha). `?id=` la sala y `?cargo=` el cargo («Jefe/a de Sala» o
// «Subjefe/a de Sala»).
//
// Se elige a la persona de toda la planilla; qué movimiento es (ascenso,
// traslado, las dos, lateral) lo dice el núcleo (`tipoDeMovimiento`), y si es
// permanente o un interinato con su fecha de fin. Guardar es
// `asignarJefaturaDeSucursal` del store, la misma que usa el portal: resuelve
// el cargo contra la tabla y, si no existe, no escribe nada.
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { tipoDeMovimiento, TEXTO_DEL_MOVIMIENTO } from '@nucleo/utils/edicionDeSucursal';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Segmentos from '../../componentes/Segmentos';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';

const CARGOS = ['Jefe/a de Sala', 'Subjefe/a de Sala'];
const VACIO = [];

export default function Jefatura() {
  const { id, cargo: cargoParam } = useLocalSearchParams();
  const cargo = CARGOS.includes(cargoParam) ? cargoParam : CARGOS[0];
  const sucursal = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(id)));
  const sucursales = useStaffStore((s) => s.branches) ?? VACIO;
  const empleados = useStaffStore((s) => s.employees) ?? VACIO;
  const asignar = useStaffStore((s) => s.asignarJefaturaDeSucursal);

  const [buscar, setBuscar] = useState('');
  const [elegidoId, setElegidoId] = useState(null);
  const [permanente, setPermanente] = useState(true);
  const [fin, setFin] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);

  const activos = useMemo(() => empleados.filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO'), [empleados]);
  const lista = useMemo(() => (buscar.trim() ? activos.filter((e) => tokenMatch(buscar.trim(), e.name, e.role)) : activos).slice(0, 40), [activos, buscar]);
  const elegido = activos.find((e) => e.id === elegidoId) || null;
  const salaDe = (e) => sucursales.find((b) => String(b.id) === String(e?.branchId))?.name || 'Sin sala';

  if (!sucursal) return <Aviso texto="No se encontró la sucursal." />;
  const movimiento = tipoDeMovimiento(elegido, sucursal, cargo);

  const guardar = () => {
    if (!elegido) { Alert.alert('Falta la persona', 'Elige a quién asignar.'); return; }
    if (!permanente && !fin) { Alert.alert('Falta la fecha', 'Para un interinato, la fecha de fin es obligatoria.'); return; }
    Alert.alert(`Asignar ${cargo}`, `${shortEmployeeName(elegido)} pasa a ${cargo} de ${sucursal.name}${permanente ? '' : ` (interino hasta el ${fin})`}. ${TEXTO_DEL_MOVIMIENTO[movimiento] || ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Asignar', onPress: async () => {
        setGuardando(true);
        trabajando('Asignando…');
        try {
          await asignar({
            branch: sucursal, targetRole: cargo, currentAssignee: null, selectedEmpId: elegido.id, moveType: movimiento,
            isPermanent: permanente, interimEndDate: permanente ? null : fin, notes: notas.trim(), desde: 'app',
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Asignado', `${shortEmployeeName(elegido)} · ${cargo}`);
          volver(`/sucursal/${sucursal.id}`);
        } catch (e) {
          fallo('No se pudo asignar', mensajeAmigable(e, 'Intenta de nuevo.'));
        } finally {
          setGuardando(false);
        }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Asignar ${cargo}`,
        headerSearchBarOptions: { placeholder: 'Nombre o cargo', hideWhenScrolling: false, onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar('') } }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 60, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Seccion titulo={`${sucursal.name} · ${cargo}`} pie={elegido ? `${shortEmployeeName(elegido)} asumirá como ${cargo}. ${TEXTO_DEL_MOVIMIENTO[movimiento] || ''}` : 'Elige a la persona de la lista.'}>
            {lista.map((e, i) => {
              const sel = e.id === elegidoId;
              return (
                <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setElegidoId(e.id); }} accessibilityRole="button" accessibilityState={{ selected: sel }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Avatar empleado={e} tamano={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: sel ? '800' : '600' }}>{shortEmployeeName(e)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[e.role, salaDe(e)].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {sel ? <Text style={{ color: MARCA.verde, fontSize: 18, fontWeight: '800' }}>✓</Text> : null}
                </Pressable>
              );
            })}
            {!lista.length ? <Text style={{ color: colorSistema.texto2 }}>Nadie con ese nombre o cargo.</Text> : null}
          </Seccion>

          <Seccion titulo="Tipo de asignación">
            <Segmentos opciones={[{ id: 'si', label: 'Permanente' }, { id: 'no', label: 'Interino' }]} activa={permanente ? 'si' : 'no'} onCambiar={(v) => setPermanente(v === 'si')} margen={0} />
            {!permanente ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fin del interinato</Text>
                <Fecha valor={fin} onCambiar={setFin} />
              </View>
            ) : null}
            <Campo value={notas} onChangeText={setNotas} placeholder={permanente ? 'Notas sobre la asignación (opcional)' : 'Ej. Cubre vacaciones de…'} />
          </Seccion>

          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={guardando ? 'Asignando…' : 'Asignar'} onPress={guardar} deshabilitado={guardando || !elegido} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
