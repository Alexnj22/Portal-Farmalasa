// Dónde está un producto en cada sala, NATIVO — el `LocationGrid` del catálogo
// del portal: por sala, en la sala de ventas (vitrina o estante, número y
// peldaño) y en la bodega interna (número y peldaño). Una sala que queda vacía
// se borra. Las filas salen del núcleo (`ubicacionesParaGuardar`) y se escriben
// con `guardarUbicacionesProducto`, igual que allá.
import { volver } from '../../componentes/volver';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchUbicacionesDeProducto, guardarUbicacionesProducto } from '@nucleo/data/productos';
import { ubicacionesEditables, ubicacionesParaGuardar } from '@nucleo/utils/edicionDeProducto';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

export default function UbicacionesDelProducto() {
  const { id, nombre } = useLocalSearchParams();
  const productId = Number(id);
  const branches = useStaffStore((s) => s.branches);
  const [locs, setLocs] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (!branches?.length) return;
    Promise.resolve(fetchUbicacionesDeProducto(productId)).then(({ data }) => setLocs(ubicacionesEditables(branches, data ?? [])))
      .catch((e) => { fallo('No se pudo cargar', mensajeAmigable(e)); setLocs(ubicacionesEditables(branches, [])); });
  }, [productId, branches]);
  if (!locs) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ubicaciones' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  const set = (i, campo, v) => setLocs((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  const guardar = () => {
    const { toUpsert, toDelete } = ubicacionesParaGuardar(productId, locs);
    Alert.alert('Guardar ubicaciones', `${toUpsert.length} sala${toUpsert.length === 1 ? '' : 's'} con ubicación${toDelete.length ? ` · ${toDelete.length} sin ubicación` : ''}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true);
        try {
          const { error } = await guardarUbicacionesProducto(productId, toUpsert, toDelete, { desde: 'app' });
          if (error) throw error;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Guardado', 'Ubicaciones actualizadas.');
          volver('/productos');
        } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); } finally { setGuardando(false); }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ubicaciones', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', marginHorizontal: 4 }}>{nombre}</Text>
        {locs.map((l, i) => (
          <Seccion key={l.branch_id} titulo={l.branch_name}>
            <Segmentos margen={0} activa={l.view} onCambiar={(v) => set(i, 'view', v)} opciones={[{ id: 'sala', label: 'Sala de ventas' }, { id: 'bodega', label: 'Bodega interna' }]} />
            {l.view === 'sala' ? (
              <>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {['vitrina', 'estante'].map((t) => (
                    <Pressable key={t} onPress={() => set(i, 'tipo', t)}
                      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: l.tipo === t ? MARCA.azulClaro : 'rgba(127,127,127,0.16)' }}>
                      <Text style={{ color: l.tipo === t ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{t === 'vitrina' ? 'Vitrina' : 'Estante'}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Campo multiline={false} value={l.numero} onChangeText={(t) => set(i, 'numero', t)} placeholder={l.tipo === 'vitrina' ? 'Vitrina nº' : 'Estante nº'} /></View>
                  <View style={{ flex: 1 }}><Campo multiline={false} value={l.peldano} onChangeText={(t) => set(i, 'peldano', t)} placeholder="Peldaño" /></View>
                </View>
              </>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Campo multiline={false} value={l.bodega_numero} onChangeText={(t) => set(i, 'bodega_numero', t)} placeholder="Estante nº" /></View>
                <View style={{ flex: 1 }}><Campo multiline={false} value={l.bodega_peldano} onChangeText={(t) => set(i, 'bodega_peldano', t)} placeholder="Peldaño" /></View>
              </View>
            )}
          </Seccion>
        ))}
        <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.azul} deshabilitado={guardando} onPress={guardar} />
      </ScrollView>
    </>
  );
}
