// Objetos huérfanos, NATIVO — `OrphanObjectsView`: el tablero de candidatos a
// código muerto. No detecta nada solo: cada fila entra por migración cuando se
// confirma un caso real, y acá sólo se marca su estado (permiso
// `orphan_objects` editar). Mismas pestañas, mismos estados y la misma
// escritura con su bitácora (`data/orphanObjects`).
import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchOrphanObjects, updateOrphanObjectStatus, ESTADOS_HUERFANO, PESTANAS_HUERFANOS, huerfanosDePestana } from '@nucleo/data/orphanObjects';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';

const COLOR = { candidate: MARCA.ambar, confirmed_orphan: MARCA.rojo, false_positive: colorSistema.texto2, resolved: MARCA.verde };
const OPCIONES = Object.entries(ESTADOS_HUERFANO);

export default function ObjetosHuerfanos() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('orphan_objects', 'can_edit');
  const [filas, setFilas] = useState(null);
  const [pestana, setPestana] = useState('todos');
  const [recargando, setRecargando] = useState(false);
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error } = await Promise.resolve(fetchOrphanObjects()).catch((e) => ({ error: e }));
    if (error) fallo('No se pudo cargar', error.message || 'Vuelve a intentar.');
    setFilas(data || []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

  const cambiar = (fila, estado) => {
    if (estado === fila.status) return;
    Alert.alert('Cambiar estado', `«${fila.title}» pasa a ${ESTADOS_HUERFANO[estado]}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cambiar', onPress: async () => {
        setGuardando(fila.id);
        const { data, error } = await Promise.resolve(updateOrphanObjectStatus(fila.id, estado, { title: fila.title, from: fila.status })).catch((e) => ({ error: e }));
        setGuardando(null);
        if (error) { fallo('No se pudo cambiar', error.message || 'Vuelve a intentar.'); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setFilas((prev) => prev.map((r) => (r.id === fila.id ? { ...r, status: data.status, resolved_at: data.resolved_at } : r)));
      } },
    ]);
  };

  const elegir = (fila) => {
    if (!puedeEditar || guardando) return;
    const rotulos = OPCIONES.map(([, l]) => l);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: fila.title, options: [...rotulos, 'Cancelar'], cancelButtonIndex: rotulos.length },
        (i) => { if (i < rotulos.length) cambiar(fila, OPCIONES[i][0]); });
    } else {
      Alert.alert(fila.title, 'Nuevo estado', [...OPCIONES.map(([k, l]) => ({ text: l, onPress: () => cambiar(fila, k) })), { text: 'Cancelar', style: 'cancel' }]);
    }
  };

  const visibles = huerfanosDePestana(filas || [], pestana);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Objetos huérfanos', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ marginHorizontal: 16 }}>
          <Aviso texto="Candidatos a código muerto (componentes, funciones o procesos sin quien los use). No se detectan solos: cada fila se agrega cuando se confirma un caso real; aquí sólo se marca su estado." />
        </View>
        <Segmentos opciones={PESTANAS_HUERFANOS.map((t) => ({ id: t.key, label: t.label }))} activa={pestana} onCambiar={setPestana} />
        {filas && !visibles.length ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 24 }}>Sin objetos para este filtro.</Text> : null}
        {visibles.map((f) => (
          <Pressable key={f.id} onPress={() => elegir(f)} disabled={!puedeEditar} style={{ marginHorizontal: 16 }}
            accessibilityRole={puedeEditar ? 'button' : undefined} accessibilityLabel={`${f.title}, ${ESTADOS_HUERFANO[f.status] || f.status}`}>
            {({ pressed }) => (
              <Vidrio radio={18} interactivo={puedeEditar}>
                <View style={{ padding: 14, gap: 4, transform: [{ scale: pressed ? 0.98 : 1 }], opacity: guardando === f.id ? 0.5 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.title}</Text>
                    <Pildora texto={ESTADOS_HUERFANO[f.status] || f.status} color={COLOR[f.status] || MARCA.ambar} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }} numberOfLines={2}>{f.ref}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${String(f.kind || '').toUpperCase()} · detectado ${fechaTexto(f.detected_at)}`}</Text>
                  {f.notes ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{f.notes}</Text> : null}
                </View>
              </Vidrio>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}
