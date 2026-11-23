// Dónde está un producto en cada sala, NATIVO — el `LocationGrid` del catálogo
// del portal: por sala, en la sala de ventas (vitrina o estante, número y
// peldaño) y en la bodega interna (número y peldaño). Una sala que queda vacía
// se borra. Las filas salen del núcleo (`ubicacionesParaGuardar`) y se escriben
// con `guardarUbicacionesProducto`, igual que allá.
import { volver } from '../../componentes/volver';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchUbicacionesDeProducto, guardarUbicacionesProducto } from '@nucleo/data/productos';
import { ubicacionesEditables, ubicacionesParaGuardar } from '@nucleo/utils/edicionDeProducto';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { BotonGrande, Campo, Ficha, Seccion, Cargando } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import { ErrorConReintento } from '../../componentes/ListaPaginada';

export default function UbicacionesDelProducto() {
  const { id, nombre } = useLocalSearchParams();
  const productId = Number(id);
  const branches = useStaffStore((s) => s.branches);
  const [locs, setLocs] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // La carga que falló (2026-11-23): el `error` de la consulta se ignoraba y la
  // excepción abría la grilla VACÍA; «Guardar» mandaba cada sucursal a borrar
  // y el producto se quedaba sin ubicaciones. Sin lo leído no hay grilla.
  const [fallaCarga, setFallaCarga] = useState(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    if (!branches?.length) return;
    setFallaCarga(null); // eslint-disable-line react-hooks/set-state-in-effect -- reintento
    Promise.resolve(fetchUbicacionesDeProducto(productId))
      .then(({ data, error }) => { if (error) throw error; setLocs(ubicacionesEditables(branches, data ?? [])); })
      .catch((e) => setFallaCarga(mensajeAmigable(e, 'No se pudieron cargar las ubicaciones.')));
  }, [productId, branches, intento]);
  if (fallaCarga && !locs) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ubicaciones' }} /><ErrorConReintento mensaje={fallaCarga} onReintentar={() => setIntento((n) => n + 1)} /></>;
  if (!locs) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ubicaciones' }} /><Cargando /></>;

  const set = (i, campo, v) => setLocs((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  const guardar = () => {
    const { toUpsert, toDelete } = ubicacionesParaGuardar(productId, locs);
    Alert.alert('Guardar ubicaciones', `${toUpsert.length} ${toUpsert.length === 1 ? 'sucursal' : 'sucursales'} con ubicación${toDelete.length ? ` · ${toDelete.length} sin ubicación` : ''}.`, [
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
                    <Ficha key={t} texto={t === 'vitrina' ? 'Vitrina' : 'Estante'} activa={l.tipo === t} color={MARCA.azulClaro} onPress={() => set(i, 'tipo', t)} />
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
