// Torogoz · Proveedores, NATIVO — la lista que el portal abre desde Compras
// («Proveedores»): NIT, plazo, si es relacionada o está inactivo; tocar uno lo
// edita y «Nuevo proveedor» da el alta. Sólo quien configura.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchProveedores } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { GRIS, PETROLEO, guardarElegida } from '../../componentes/torogoz/comercial/Piezas';

export default function ProveedoresTorogoz() {
  const { hasPermission } = useAuth();
  const puede = !!hasPermission?.('distribucion_config', 'can_edit');
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setLista(await fetchProveedores()); setError(''); }
    catch (e) { setError(mensajeDeDistribucion(e)); setLista((x) => x ?? []); }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const visibles = useMemo(() => (lista ?? []).filter((p) => !buscar.trim() || tokenMatch(buscar, p.nombre, p.nit || '')), [lista, buscar]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Proveedores', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Nombre o NIT', hideWhenScrolling: false,
          onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar('') },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {puede ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Nuevo proveedor" color={PETROLEO} onPress={() => router.push({ pathname: '/torogoz/proveedor/[id]', params: { id: 'nuevo' } })} />
          </View>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {lista === null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {visibles.map((p) => (
          <Pressable key={p.id} disabled={!puede} accessibilityRole="button" accessibilityLabel={`Editar ${p.nombre}`}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); guardarElegida('proveedor', p); router.push({ pathname: '/torogoz/proveedor/[id]', params: { id: String(p.id) } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo={puede}>
              <View style={{ padding: 14, gap: 5 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${p.nit ? `NIT ${p.nit}` : 'Sin NIT'} · ${p.plazo_dias ? `${p.plazo_dias} días de plazo` : 'contado'}`}
                </Text>
                {p.relacionada || !p.activo || p.gran_contribuyente ? (
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {p.relacionada ? <Pildora texto="Relacionada" color={MARCA.violetaClaro} /> : null}
                    {p.gran_contribuyente ? <Pildora texto="Gran contribuyente" color={MARCA.azulClaro} /> : null}
                    {!p.activo ? <Pildora texto="Inactivo" color={GRIS} /> : null}
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </Pressable>
        ))}
        {lista !== null && !visibles.length && !error ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 32, fontSize: 15 }}>{buscar.trim() ? 'Ninguno coincide.' : 'Sin proveedores todavía.'}</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
