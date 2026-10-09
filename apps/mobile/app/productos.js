// Productos, NATIVO — el catálogo del portal (`TabCatalogo`) para consultarlo
// en el teléfono: el nombre, el laboratorio y el principio activo, si va bajo
// receta, si está activo, y su foto. Busca con la regla del portal (nombre,
// principio activo y laboratorio, `buscar_productos_ids`) y pagina en el
// servidor (`fetchProductsList`, de a 30). Tocar uno abre su ficha: cuánto hay
// en cada sala y sus precios por presentación.
//
// Arriba, las cuentas del catálogo del portal (activos, inactivos, nuevos del
// mes, modificados del mes y —con costos— en pérdida y con margen bajo); las
// que filtran, filtran igual (núcleo: `fetchIdsModificadosDesde`,
// `fetchIdsPorMargen`). La ficha edita foto, devolutivo, categoría, principios
// activos y ubicaciones. Las presentaciones se ven en `presentaciones`.
import { memo, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchIdsModificadosDesde, fetchIdsPorMargen, fetchProductCounts, fetchProductsList } from '@nucleo/data/productos';
import { useAuth } from '@nucleo/context/AuthContext';
import { nivelesVisibles } from '@nucleo/utils/preciosDeProducto';
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
import ListaPaginada from '../componentes/ListaPaginada';
import { MARCA } from '../componentes/inicio/marca';

const POR_PAGINA = 30;

// El catálogo son miles: lista virtualizada que pide la página siguiente al
// llegar abajo, y fila memoizada.
const FilaProducto = memo(function FilaProducto({ p }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/producto/[id]', params: { id: String(p.id), nombre: p.nombre } }); }}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
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
  );
});

export default function Productos() {
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [estado, setEstado] = useState('activos');
  const [categoria, setCategoria] = useState('todas');
  const [categorias, setCategorias] = useState([]);
  // La cuenta y el «parecidos» los dice la última página que llegó.
  const [resumen, setResumen] = useState({ total: null, aproximado: false });
  const { hasPermission, maxPriceLevel } = useAuth();
  const conCosto = hasPermission('productos_ver_costos');
  const [cuentas, setCuentas] = useState(null);
  const [modificados, setModificados] = useState(null);
  const [margen, setMargen] = useState(null);
  const [foco, setFoco] = useState('todos');   // 'todos' | 'nuevos' | 'modificados' | 'perdida' | 'bajo'
  useEffect(() => {
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
    Promise.resolve(fetchProductCounts(inicioMes)).then(([a, i, n]) => setCuentas({ activos: a.count ?? 0, inactivos: i.count ?? 0, nuevos: n.count ?? 0 })).catch(() => {});
    Promise.resolve(fetchIdsModificadosDesde(inicioMes)).then(setModificados).catch(() => setModificados(new Set()));
    if (conCosto) {
      const campos = nivelesVisibles(maxPriceLevel).filter((f) => f.key !== 'precio_7' && f.key !== 'premium');
      Promise.resolve(fetchIdsPorMargen(campos)).then(setMargen).catch(() => setMargen({ perdida: new Set(), bajo: new Set() }));
    }
  }, [conCosto, maxPriceLevel]);

  useEffect(() => { fetchProductCategories().then(({ data }) => setCategorias((data || []).map((r) => r.nombre))).catch(() => {}); }, []);

  // Una página de la base (`fetchProductsList`, la misma del portal). Los
  // focos «modificados / en pérdida / margen bajo» filtran por los ids que
  // calculan sus cuentas; mientras no llegan, la lista espera vacía y se
  // vuelve a pedir sola cuando llegan (están en `dependencias`).
  const cargarPagina = async (desde, porPagina) => {
    const ids = foco === 'modificados' ? (modificados ? [...modificados] : null)
      : foco === 'perdida' ? (margen ? [...margen.perdida] : null)
        : foco === 'bajo' ? (margen ? [...margen.bajo] : null) : null;
    if (foco !== 'todos' && foco !== 'nuevos' && ids == null) return [];
    if (ids && !ids.length) { setResumen({ total: 0, aproximado: false }); return []; }
    const ahora = new Date();
    const { data, count, error, aproximado } = await fetchProductsList({
      search: busqueda || null, page: Math.floor(desde / porPagina) + 1, pageSize: porPagina, filterActivo: estado, laboratorioId: null,
      categoria: categoria === 'todas' ? null : categoria,
      filterNuevos: foco === 'nuevos' ? new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString() : null,
      effectiveBids: ids, sortField: 'nombre', sortDir: 'asc',
    });
    if (error) return { error };
    setResumen({ total: count || 0, aproximado: !!aproximado });
    return data || [];
  };

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
      <ListaPaginada porPagina={30} cargarPagina={cargarPagina}
        dependencias={[busqueda, estado, categoria, foco, modificados, margen]}
        keyExtractor={(p) => String(p.id)} renderItem={(p) => <FilaProducto p={p} />}
        vacio={busqueda ? 'Ningún producto con esa búsqueda' : 'Sin productos'}
        cabecera={(
          <View style={{ gap: 10, marginBottom: 2 }}>
            <FiltrosActivos grupos={grupos} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {[
                ['todos', 'Activos', cuentas?.activos, null],
                ['inactivos', 'Inactivos', cuentas?.inactivos, null],
                ['nuevos', 'Nuevos del mes', cuentas?.nuevos, MARCA.verde],
                ['modificados', 'Modificados', modificados?.size, MARCA.ambar],
                ...(conCosto ? [['perdida', 'En pérdida', margen?.perdida.size, MARCA.rojo], ['bajo', 'Margen bajo', margen?.bajo.size, MARCA.ambar]] : []),
              ].map(([id, rotulo, n, color]) => {
                const activo = id === 'inactivos' ? estado === 'todos' && foco === 'todos' : foco === id && id !== 'todos';
                return (
                  <Pressable key={id} disabled={id === 'todos' || id === 'inactivos'} onPress={() => { Haptics.selectionAsync().catch(() => {}); setFoco((f) => (f === id ? 'todos' : id)); }}>
                    <Vidrio radio={16}>
                      <View style={{ paddingHorizontal: 14, paddingVertical: 10, minWidth: 104, borderRadius: 16, borderWidth: activo ? 1.5 : 0, borderColor: color ?? MARCA.azulClaro }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{rotulo}</Text>
                        <Text style={{ color: color ?? colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{n == null ? '—' : n.toLocaleString('es-SV')}</Text>
                      </View>
                    </Vidrio>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Presentaciones" borde onPress={() => router.push('/presentaciones')} /></View>
            <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'activos', label: 'Activos' }, { id: 'todos', label: 'Todos' }]} />
            {resumen.aproximado && busqueda ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran productos parecidos." /></View> : null}
            {resumen.total != null ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${resumen.total.toLocaleString('es-SV')} producto${resumen.total === 1 ? '' : 's'}`}</Text>
            ) : null}
          </View>
        )} />
    </>
  );
}
