// Presentaciones, NATIVO — la pestaña del catálogo del portal
// (`TabPresentaciones`): el catálogo visto por el envase en que se vende cada
// producto. Una fila por NOMBRE (cuántos registros lo repiten, cuántos
// productos y cuántos activos, el factor más frecuente y su rango si varía);
// filtros «repetidas» y «factor variable»; tocar una abre sus productos.
//
// Es de sólo lectura, igual que allá: `presentaciones` la escribe el sync de
// productos y un nombre editado acá volvería solo a su valor original.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPresentacionesMaestro, fetchProductosPorPresentacion } from '@nucleo/data/presentaciones';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatQty } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Campo } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const CORTE = 100;

function Productos({ tipo }) {
  const [lista, setLista] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    Promise.resolve(fetchProductosPorPresentacion(tipo)).then(({ data }) => setLista(data ?? [])).catch(() => setLista([]));
  }, [tipo]);
  const coinciden = useMemo(() => (q.trim() ? (lista ?? []).filter((p) => tokenMatch(q, p.nombre, p.laboratorio, p.codigo_barras)) : (lista ?? [])), [lista, q]);
  if (!lista) return <ActivityIndicator style={{ marginVertical: 10 }} />;
  return (
    <View style={{ gap: 6, paddingTop: 8 }}>
      {lista.length > 8 ? <Campo multiline={false} value={q} onChangeText={setQ} placeholder="Buscar en estos productos" /> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${formatQty(coinciden.length)} de ${formatQty(lista.length)} productos${coinciden.length > CORTE ? ` · se muestran ${CORTE}` : ''}`}</Text>
      {coinciden.slice(0, CORTE).map((p) => (
        <Pressable key={`${p.product_id}-${p.factor}`} onPress={() => router.push({ pathname: '/producto/[id]', params: { id: String(p.product_id), nombre: p.nombre } })}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: p.activo ? colorSistema.texto : colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>{p.nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[p.laboratorio || 'Sin laboratorio', p.factor != null ? `factor ${formatQty(p.factor)}` : null, p.descripcion, p.activo ? null : 'inactivo'].filter(Boolean).join(' · ')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Presentaciones() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [orden, setOrden] = useState('productos');
  const [abierta, setAbierta] = useState(null);
  useEffect(() => {
    Promise.resolve(fetchPresentacionesMaestro()).then(({ data, error: e }) => { if (e) throw e; setFilas(data ?? []); })
      .catch((e) => { setError(mensajeAmigable(e)); setFilas([]); });
  }, []);
  const resumen = useMemo(() => ({
    total: (filas ?? []).length,
    repetidas: (filas ?? []).filter((r) => (r.codigos ?? 1) > 1).length,
    vario: (filas ?? []).filter((r) => (r.factores ?? 1) > 1).length,
  }), [filas]);
  const visibles = useMemo(() => {
    let out = filas ?? [];
    if (filtro === 'repetidas') out = out.filter((r) => (r.codigos ?? 1) > 1);
    if (filtro === 'vario') out = out.filter((r) => (r.factores ?? 1) > 1);
    if (busca.trim()) out = out.filter((r) => tokenMatch(busca, r.tipo));
    return [...out].sort((a, b) => (orden === 'tipo' ? String(a.tipo).localeCompare(String(b.tipo), 'es') : Number(b[orden] ?? 0) - Number(a[orden] ?? 0) || String(a.tipo).localeCompare(String(b.tipo), 'es')));
  }, [filas, filtro, busca, orden]);
  const grupos = [
    { id: 'filtro', titulo: 'Mostrar', activa: filtro, porDefecto: 'todas', onCambiar: setFiltro,
      opciones: [{ id: 'todas', label: 'Todas' }, { id: 'repetidas', label: `Repetidas (${resumen.repetidas})` }, { id: 'vario', label: `Factor variable (${resumen.vario})` }] },
    { id: 'orden', titulo: 'Orden', activa: orden, porDefecto: 'productos', onCambiar: setOrden,
      opciones: [{ id: 'productos', label: 'Más productos' }, { id: 'activos', label: 'Más activos' }, { id: 'factor', label: 'Factor' }, { id: 'tipo', label: 'Nombre' }] },
  ];
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Presentaciones', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Nombre de la presentación', onChangeText: (e) => setBusca(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 10 }} keyboardShouldPersistTaps="handled">
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${resumen.total} presentaciones · ${resumen.repetidas} repetidas · ${resumen.vario} con factor variable`}</Text>
        {filas == null ? <ActivityIndicator /> : visibles.map((r) => (
          <View key={r.tipo} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18} interactivo>
              <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abierta === r.tipo ? null : r.tipo); }} style={{ padding: 14, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{r.tipo}</Text>
                  {(r.codigos ?? 1) > 1 ? <Pildora texto={`×${r.codigos} registros`} color={MARCA.azulClaro} /> : null}
                  {(r.factores ?? 1) > 1 ? <Pildora texto="factor variable" color={MARCA.ambar} /> : null}
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[`${formatQty(r.productos)} productos`, `${formatQty(r.activos)} activos`, `factor ${formatQty(r.factor)}${(r.factores ?? 1) > 1 ? ` (${formatQty(r.factor_min)}–${formatQty(r.factor_max)})` : ''}`].join(' · ')}
                </Text>
                {abierta === r.tipo ? <Productos tipo={r.tipo} /> : null}
              </Pressable>
            </Vidrio>
          </View>
        ))}
      </ScrollView>
    </>
  );
}
