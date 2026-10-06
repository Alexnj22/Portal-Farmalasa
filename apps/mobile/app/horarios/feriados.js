// Los feriados, NATIVO — la pestaña «Feriados» de Horarios del portal: por año
// (el anterior, éste y el siguiente), agrupados por mes; agregar (nacional o
// municipal, recurrente) y quitar con las MISMAS acciones del store
// (`addHoliday`, `deleteHoliday`). Un asueto cambia lo que se PAGA ese día
// (CT Art. 190 y siguientes): por eso las dos acciones lo anotan, y quitar uno
// pide confirmación.
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../../componentes/Segmentos';
import { MenuDeFiltros } from '../../componentes/Filtros';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { BotonGrande, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Vidrio from '../../componentes/Vidrio';
import ConAurora from '../../componentes/ConAurora';
import { Encabezado } from '../../componentes/personas/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function Feriados() {
  const { hasPermission } = useAuth();
  const puedeEditar = !!hasPermission?.('schedules', 'can_edit');
  const feriados = useStaffStore((s) => s.holidays);
  const addHoliday = useStaffStore((s) => s.addHoliday);
  const deleteHoliday = useStaffStore((s) => s.deleteHoliday);
  const anioActual = Number(hoySV().slice(0, 4));
  const [anio, setAnio] = useState(String(anioActual));
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const porMes = useMemo(() => {
    const delAnio = (feriados || []).filter((h) => h.holiday_date?.startsWith(anio) && (!busca.trim() || tokenMatch(busca, h.name)));
    return MESES.map((mes, i) => ({ mes, items: delAnio.filter((h) => Number(h.holiday_date.slice(5, 7)) === i + 1) })).filter((m) => m.items.length);
  }, [feriados, anio, busca]);

  const quitar = (h) => {
    if (!puedeEditar) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert('Quitar el feriado', `«${h.name}» (${fechaTexto(h.holiday_date, { day: 'numeric', month: 'long', year: 'numeric' })}) deja de contar como asueto: ese día se paga como cualquier otro.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: async () => {
        try { await deleteHoliday(h.id); listo('Feriado quitado', h.name); }
        catch (e) { fallo('No se pudo quitar', mensajeAmigable(e, 'Intenta de nuevo.')); }
      } },
    ]);
  };

  const guardar = async () => {
    if (!form?.name.trim() || !form.fecha) return;
    setGuardando(true);
    try {
      await addHoliday({ holiday_date: form.fecha, name: form.name.trim(), type: form.tipo, municipality: form.tipo === 'MUNICIPAL' ? form.muni.trim() || null : null, is_recurring: form.recurrente });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Feriado agregado', form.name.trim());
      setAnio(form.fecha.slice(0, 4));
      setForm(null);
    } catch (e) { fallo('No se guardó el feriado', mensajeAmigable(e, 'Intenta de nuevo.')); }
    finally { setGuardando(false); }
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Feriados', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Buscar feriado', hideWhenScrolling: false, onChangeText: (e) => setBusca(e.nativeEvent.text), onCancelButtonPress: () => setBusca('') },
      }} />
      <MenuDeFiltros grupos={[]} extra={puedeEditar ? { icono: 'plus', etiqueta: 'Agregar feriado', onPress: () => setForm({ name: '', fecha: hoySV(), tipo: 'NATIONAL', muni: '', recurrente: false }) } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Segmentos activa={anio} onCambiar={setAnio} opciones={[anioActual - 1, anioActual, anioActual + 1].map((a) => ({ id: String(a), label: String(a) }))} />
        {porMes.map(({ mes, items }) => (
          <View key={mes} style={{ gap: 8 }}>
            <Encabezado>{mes}</Encabezado>
            {items.map((h) => (
              <Pressable key={h.id} onLongPress={() => quitar(h)} delayLongPress={350} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={16}>
                  <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 46, alignItems: 'center' }}>
                      <Text style={{ color: MARCA.ambar, fontSize: 22, fontWeight: '800' }}>{Number(h.holiday_date.slice(8, 10))}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{fechaTexto(h.holiday_date, { weekday: 'short' })}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{h.name}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        <Pildora texto={h.type === 'MUNICIPAL' ? `Municipal${h.municipality ? ` · ${h.municipality}` : ''}` : 'Nacional'} color={h.type === 'MUNICIPAL' ? MARCA.violetaClaro : MARCA.azulClaro} />
                        {h.is_recurring ? <Pildora texto="Cada año" color={MARCA.verde} /> : null}
                      </View>
                    </View>
                  </View>
                </Vidrio>
              </Pressable>
            ))}
          </View>
        ))}
        {!porMes.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 32 }}>{`Sin feriados en ${anio}`}</Text> : null}
        {puedeEditar && porMes.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionado un feriado para quitarlo.</Text> : null}
      </ScrollView>

      <Modal visible={!!form} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setForm(null)}>
        {form ? (
          <ConAurora>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <Pressable onPress={() => setForm(null)} hitSlop={10}><Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '600' }}>Cancelar</Text></Pressable>
                <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>Nuevo feriado</Text>
                <View style={{ width: 70 }} />
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
                <Seccion titulo="Nombre">
                  <TextInput value={form.name} onChangeText={(v) => setForm((x) => ({ ...x, name: v }))} placeholder="Ej: Día del Trabajo" placeholderTextColor={colorSistema.texto2}
                    style={{ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
                </Seccion>
                <Seccion titulo="Fecha">
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Día</Text>
                    <Fecha valor={form.fecha} onCambiar={(v) => setForm((x) => ({ ...x, fecha: v }))} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Se repite cada año</Text>
                    <Switch value={form.recurrente} onValueChange={(v) => setForm((x) => ({ ...x, recurrente: v }))} />
                  </View>
                </Seccion>
                <Seccion titulo="Tipo">
                  <Opciones opciones={[{ id: 'NATIONAL', label: 'Nacional' }, { id: 'MUNICIPAL', label: 'Municipal', detalle: 'Sólo en un municipio' }]}
                    valor={form.tipo} onCambiar={(v) => setForm((x) => ({ ...x, tipo: v }))} />
                  {form.tipo === 'MUNICIPAL' ? (
                    <TextInput value={form.muni} onChangeText={(v) => setForm((x) => ({ ...x, muni: v }))} placeholder="Municipio" placeholderTextColor={colorSistema.texto2}
                      style={{ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
                  ) : null}
                </Seccion>
                <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar feriado'} color={MARCA.ambar} onPress={guardar} deshabilitado={guardando || !form.name.trim() || !form.fecha} />
              </ScrollView>
            </KeyboardAvoidingView>
          </ConAurora>
        ) : null}
      </Modal>
    </>
  );
}
