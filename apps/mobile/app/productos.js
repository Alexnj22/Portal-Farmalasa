// Productos, NATIVO — el catálogo del portal (`TabCatalogo`) para consultarlo
// en el teléfono: el nombre, el laboratorio y el principio activo, si va bajo
// receta, si está activo, y su foto. Busca con la regla del portal (nombre,
// principio activo y laboratorio, `buscar_productos_ids`) y pagina en el
// servidor (`fetchProductsList`, de a 30). Tocar uno abre su ficha: cuánto hay
// en cada sala y sus precios por presentación.
//
// Editar la ficha (precios, foto, principio activo) se hace en el portal.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchProductsList } from '@nucleo/data/productos';
import { fetchProductCategories } from '@nucleo/data/inventarioTab';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { Chip } from '../componentes/inicio/Widget';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const POR_PAGINA = 30;

export default function Productos() {
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [estado, setEstado] = useState('activos');
  const [categoria, setCategoria] = useState('todas');
  const [categorias, setCategorias] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ filas: [], total: 0, aproximado: false });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const pedido = useRef(0);

  useEffect(() => { fetchProductCategories().then(({ data }) => setCategorias((data || []).map((r) => r.nombre))).catch(() => {}); }, []);
  useEffect(() => { setPagina(1); }, [busqueda, estado, categoria]);

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    try {
      const { data, count, error: e, aproximado } = await fetchProductsList({
        search: busqueda || null, page: pagina, pageSize: POR_PAGINA, filterActivo: estado, laboratorioId: null,
        categoria: categoria === 'todas' ? null : categoria, filterNuevos: null, effectiveBids: null, sortField: 'nombre', sortDir: 'asc',
      });
      if (yo !== pedido.current) return;   // llegó tarde: ya se pidió otra cosa
      if (e) throw e;
      setError(null);
      setDatos((d) => ({ filas: pagina === 1 ? (data || []) : [...d.filas, ...(data || [])], total: count || 0, aproximado: !!aproximado }));
    } catch {
      if (yo === pedido.current) setError('No se pudo cargar el catálogo.');
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [busqueda, estado, categoria, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const grupos = [{ id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
    opciones: [{ id: 'todas', label: 'Todas' }, ...categorias.map((c) => ({ id: c, label: c }))] }];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Productos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, principio activo o laboratorio', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'activos', label: 'Activos' }, { id: 'todos', label: 'Todos' }]} />
        {datos.aproximado && busqueda ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran productos parecidos." /></View> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {!cargando || datos.filas.length ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${datos.total.toLocaleString('es-SV')} producto${datos.total === 1 ? '' : 's'}`}</Text>
        ) : null}
        {datos.filas.map((p) => (
          <Pressable key={p.id}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/producto/[id]', params: { id: String(p.id), nombre: p.nombre } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                {p.foto_url
                  ? <Image source={{ uri: p.foto_url }} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#fff' }} resizeMode="contain" />
                  : <Chip icono="Pill" color={MARCA.azulClaro} tamano={48} />}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: p.activo ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{p.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                    {[p.laboratorios?.nombre, p.principio_activo].filter(Boolean).join(' · ') || 'Sin laboratorio'}
                  </Text>
                  {p.es_antibiotico || !p.activo || p.tipo_medicamento ? (
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {p.es_antibiotico ? <Pildora texto="Bajo Receta" color={MARCA.violeta} /> : null}
                      {!p.activo ? <Pildora texto="Inactivo" color={colorSistema.texto2} /> : null}
                      {p.tipo_medicamento ? <Pildora texto={p.tipo_medicamento} color={colorSistema.texto2} /> : null}
                    </View>
                  ) : null}
                </View>
              </View>
            </Vidrio>
          </Pressable>
        ))}
        {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!cargando && datos.total > datos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((n) => n + 1)} /></View> : null}
        {!cargando && !datos.filas.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{busqueda ? 'Ningún producto con esa búsqueda' : 'Sin productos'}</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
