// Categoría de proveedores en lote, NATIVO — la barra de selección de
// `ProveedoresView` del portal: se eligen varios proveedores y se les pone
// la misma categoría (`setProveedoresCategoriaBulk`), o a cada uno LA SUYA,
// la sugerida por su propio giro (`applyProveedoresCategoriaSugerida`). Las
// dos anotan en la bitácora. Pide `proveedores.can_edit`.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { applyProveedoresCategoriaSugerida, fetchProveedorCategorias, fetchProveedoresMaestro, setProveedoresCategoriaBulk } from '@nucleo/data/proveedores';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function ProveedoresEnLote() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('proveedores', 'can_edit');
  const [filas, setFilas] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('sin');
  const [sel, setSel] = useState(() => new Set());
  const cargar = async () => {
    try { setFilas(await fetchProveedoresMaestro()); } catch (e) { fallo('No se pudo cargar', mensajeAmigable(e)); setFilas([]); }
  };
  useEffect(() => {
    cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial
    Promise.resolve(fetchProveedorCategorias()).then(({ data }) => setCategorias(data ?? [])).catch(() => {});
  }, []);
  const visibles = useMemo(() => {
    let out = (filas ?? []).filter((r) => r.activo !== false);
    if (filtro === 'sin') out = out.filter((r) => !r.categoria_id);
    if (filtro === 'sugerida') out = out.filter((r) => r.categoria_sugerida_id && r.categoria_sugerida_id !== r.categoria_id);
    if (busca.trim()) out = out.filter((r) => tokenMatch(busca, r.nombre, r.alias, r.nit));
    return out;
  }, [filas, filtro, busca]);
  const conSugerida = useMemo(() => (filas ?? []).filter((r) => sel.has(r.id) && r.categoria_sugerida_id).length, [filas, sel]);
  const ids = [...sel];

  const correr = async (fn, titulo) => {
    trabajando('Guardando…');
    try {
      const n = await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, `${n} proveedor${n === 1 ? '' : 'es'} cambiado${n === 1 ? '' : 's'}.`);
      setSel(new Set());
      await cargar();
    } catch (e) { fallo('No se pudo', mensajeAmigable(e)); }
  };
  const asignar = () => {
    const opciones = [...categorias.map((c) => c.nombre), 'Sin categoría', 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Categoría para ${ids.length}`, options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i === opciones.length - 1) return;
      const cat = i < categorias.length ? categorias[i] : null;
      Alert.alert('Asignar categoría', `${ids.length} proveedor${ids.length === 1 ? '' : 'es'} → ${cat?.nombre ?? 'Sin categoría'}`, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Asignar', onPress: () => correr(() => setProveedoresCategoriaBulk(ids, cat?.id ?? null), 'Categoría asignada') },
      ]);
    });
  };
  const aceptarSugeridas = () => Alert.alert('Aceptar la sugerida', `A cada uno de los ${conSugerida} con sugerencia se le pone la categoría que sale de su propio giro.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Aceptar', onPress: () => correr(() => applyProveedoresCategoriaSugerida(ids), 'Sugeridas aplicadas') },
  ]);

  const grupos = [{ id: 'filtro', titulo: 'Mostrar', activa: filtro, porDefecto: 'sin', onCambiar: (v) => { setFiltro(v); setSel(new Set()); },
    opciones: [{ id: 'sin', label: 'Sin categoría' }, { id: 'sugerida', label: 'Con sugerencia distinta' }, { id: 'todos', label: 'Todos' }] }];
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Categoría en lote', headerLargeTitle: false,
        headerSearchBarOptions: { placeholder: 'Nombre, alias o NIT', onChangeText: (e) => setBusca(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 120, gap: 10 }}>
        <FiltrosActivos grupos={grupos} />
        {!puede ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Asignar categorías pide permiso de edición en Proveedores." /></View> : null}
        <View style={{ flexDirection: 'row', marginHorizontal: 20, alignItems: 'center' }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`${visibles.length} proveedores · ${sel.size} elegidos`}</Text>
          <Pressable onPress={() => setSel(sel.size === visibles.length ? new Set() : new Set(visibles.map((r) => r.id)))} style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{sel.size === visibles.length && visibles.length ? 'Quitar todos' : 'Elegir todos'}</Text>
          </Pressable>
        </View>
        {filas == null ? <ActivityIndicator /> : (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ paddingVertical: 4 }}>
                {visibles.map((r, i) => (
                  <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setSel((s) => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else x.add(r.id); return x; }); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 54, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Text style={{ fontSize: 20, color: sel.has(r.id) ? MARCA.verde : colorSistema.texto2 }}>{sel.has(r.id) ? '●' : '○'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{r.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                        {[r.categoria_nombre ?? 'Sin categoría', r.categoria_sugerida_nombre ? `sugerida: ${r.categoria_sugerida_nombre}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </Vidrio>
          </View>
        )}
      </ScrollView>
      {puede && sel.size ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 28, flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><BotonGrande texto={`Asignar (${sel.size})`} color={MARCA.azul} onPress={asignar} /></View>
          {conSugerida ? <View style={{ flex: 1 }}><BotonGrande texto={`Sugerida (${conSugerida})`} color={MARCA.violetaClaro} onPress={aceptarSugeridas} /></View> : null}
        </View>
      ) : null}
    </>
  );
}
