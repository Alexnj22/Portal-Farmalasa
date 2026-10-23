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
// activos y ubicaciones. Las presentaciones se ven en `presentaciones`, y con
// el mismo permiso la «Revisión de factor» (`producto/revision-factor`): qué
// presentación cambió de tamaño y la existencia que hay que corregir.
//
// Como el portal: filtro por laboratorio, orden por producto, laboratorio,
// categoría o estado, y las marcas de cada fila — margen (pérdida / bajo),
// «Pérd. <precio especial>», «cambios», «ND» (no devolutivo) y «Receta» —
// que salen de `fetchIndicadoresDeCatalogo` (núcleo), lo mismo que el portal.
import { memo, useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchIdsModificadosDesde, fetchIdsPorMargen, fetchIndicadoresDeCatalogo, fetchProductCounts, fetchProductsList } from '@nucleo/data/productos';
import { fetchLaboratoriosBasic } from '@nucleo/data/laboratorios';
import { useAuth } from '@nucleo/context/AuthContext';
import { marginLabel, nivelesVisibles, specialLossLabel } from '@nucleo/utils/preciosDeProducto';
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
import { TrasLaTransicion } from '../componentes/trasLaTransicion';

const POR_PAGINA = 30;
const ORDENES = [
  { id: 'nombre:asc', label: 'Producto, A → Z' }, { id: 'nombre:desc', label: 'Producto, Z → A' },
  { id: 'lab:asc', label: 'Laboratorio, A → Z' }, { id: 'lab:desc', label: 'Laboratorio, Z → A' },
  { id: 'categoria:asc', label: 'Categoría, A → Z' }, { id: 'categoria:desc', label: 'Categoría, Z → A' },
  { id: 'activo:desc', label: 'Activos primero' }, { id: 'activo:asc', label: 'Inactivos primero' },
];
const SIN_MARCAS = { margen: undefined, especial: null, cambios: false };

// El catálogo son miles: lista virtualizada que pide la página siguiente al
// llegar abajo, y fila memoizada.
const FilaProducto = memo(function FilaProducto({ p, marcas = SIN_MARCAS }) {
  const m = marcas.margen !== undefined ? marginLabel(marcas.margen) : null;
  const especial = marcas.especial ? [...marcas.especial] : [];
  const conMarcas = p.es_antibiotico || p.requiere_receta || !p.activo || p.tipo_medicamento || m || especial.length || marcas.cambios || p.devolutivo === false;
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
            {conMarcas ? (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {m ? <Pildora texto={m.label} color={m.variante === 'danger' ? MARCA.rojo : MARCA.ambar} /> : null}
                {especial.map((k) => <Pildora key={k} texto={`Pérd. ${specialLossLabel(k)}`} color={MARCA.violeta} />)}
                {marcas.cambios ? <Pildora texto="cambios" color={MARCA.ambar} /> : null}
                {p.devolutivo === false ? <Pildora texto="ND · no devolutivo" color={MARCA.ambar} /> : null}
                {p.es_antibiotico ? <Pildora texto="Bajo Receta" color={MARCA.violeta} /> : null}
                {p.requiere_receta ? <Pildora texto="Receta" color={MARCA.rojo} /> : null}
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
  const [lab, setLab] = useState('todos');
  const [labs, setLabs] = useState([]);
  const [orden, setOrden] = useState('nombre:asc');
  // Las marcas de las filas cargadas, por id (se suman página a página).
  const [marcas, setMarcas] = useState({});
  // La cuenta y el «parecidos» los dice la última página que llegó.
  const [resumen, setResumen] = useState({ total: null, aproximado: false });
  const { hasPermission, maxPriceLevel } = useAuth();
  const conCosto = hasPermission('productos_ver_costos');
  const verRevision = hasPermission('productos_tab_presentaciones');
  const [cuentas, setCuentas] = useState(null);
  const [modificados, setModificados] = useState(null);
  const [margen, setMargen] = useState(null);
  // Una cuenta que falló no es cero (H34): la pastilla queda sin número.
  const [fallaron, setFallaron] = useState({});
  const [foco, setFoco] = useState('todos');   // 'todos' | 'nuevos' | 'modificados' | 'perdida' | 'bajo'
  useEffect(() => {
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
    Promise.resolve(fetchProductCounts(inicioMes)).then(([a, i, n]) => setCuentas({ activos: a.count ?? 0, inactivos: i.count ?? 0, nuevos: n.count ?? 0 })).catch(() => {});
    Promise.resolve(fetchIdsModificadosDesde(inicioMes)).then(setModificados).catch(() => { setModificados(new Set()); setFallaron((f) => ({ ...f, modificados: true })); });
    if (conCosto) {
      const campos = nivelesVisibles(maxPriceLevel).filter((f) => f.key !== 'precio_7' && f.key !== 'premium');
      Promise.resolve(fetchIdsPorMargen(campos)).then(setMargen).catch(() => { setMargen({ perdida: new Set(), bajo: new Set() }); setFallaron((f) => ({ ...f, margen: true })); });
    }
  }, [conCosto, maxPriceLevel]);

  useEffect(() => { fetchLaboratoriosBasic().then(({ data }) => setLabs((data || []).map((l) => ({ id: String(l.id), label: l.nombre })))).catch(() => {}); }, []);
  const camposMargen = nivelesVisibles(maxPriceLevel).filter((f) => f.key !== 'precio_7' && f.key !== 'premium');
  const marcar = useCallback((filas) => {
    const ids = filas.map((p) => p.id);
    if (!ids.length) return;
    // Si la lectura falla, la fila se ve sin marcas: nunca bloquea la lista.
    fetchIndicadoresDeCatalogo(ids, camposMargen).then((ind) => setMarcas((m) => {
      const n = { ...m };
      for (const id of ids) n[id] = { margen: ind.margen[id], especial: ind.perdidaEspecial[id] ?? null, cambios: ind.cambiados.has(id) };
      return n;
    })).catch(() => {});
  }, [maxPriceLevel]); // eslint-disable-line react-hooks/exhaustive-deps
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
      search: busqueda || null, page: Math.floor(desde / porPagina) + 1, pageSize: porPagina, filterActivo: estado, laboratorioId: lab === 'todos' ? null : Number(lab),
      categoria: categoria === 'todas' ? null : categoria,
      filterNuevos: foco === 'nuevos' ? new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString() : null,
      effectiveBids: ids, sortField: orden.split(':')[0], sortDir: orden.split(':')[1],
    });
    if (error) return { error };
    setResumen({ total: count || 0, aproximado: !!aproximado });
    marcar(data || []);
    return data || [];
  };

  const grupos = [
    { id: 'lab', titulo: 'Laboratorio', activa: lab, porDefecto: 'todos', onCambiar: setLab,
      opciones: [{ id: 'todos', label: 'Todos' }, ...labs] },
    { id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
      opciones: [{ id: 'todas', label: 'Todas' }, ...categorias.map((c) => ({ id: c, label: c }))] },
    { id: 'orden', titulo: 'Ordenar por', activa: orden, porDefecto: 'nombre:asc', onCambiar: setOrden, opciones: ORDENES },
  ];

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
      <TrasLaTransicion>
      <ListaPaginada porPagina={30} cargarPagina={cargarPagina}
        dependencias={[busqueda, estado, categoria, foco, modificados, margen, lab, orden]}
        keyExtractor={(p) => String(p.id)} renderItem={(p) => <FilaProducto p={p} marcas={marcas[p.id]} />} extraData={marcas}
        vacio={busqueda ? 'Ningún producto con esa búsqueda' : 'Sin productos'}
        cabecera={(
          <View style={{ gap: 10, marginBottom: 2 }}>
            <FiltrosActivos grupos={grupos} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {[
                ['todos', 'Activos', cuentas?.activos, null],
                ['inactivos', 'Inactivos', cuentas?.inactivos, null],
                ['nuevos', 'Nuevos del mes', cuentas?.nuevos, MARCA.verde],
                ['modificados', 'Modificados', fallaron.modificados ? undefined : modificados?.size, MARCA.ambar],
                ...(conCosto ? [['perdida', 'En pérdida', fallaron.margen ? undefined : margen?.perdida.size, MARCA.rojo], ['bajo', 'Margen bajo', fallaron.margen ? undefined : margen?.bajo.size, MARCA.ambar]] : []),
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
            <View style={{ marginHorizontal: 16, gap: 8 }}>
              <BotonGrande texto="Presentaciones" borde onPress={() => router.push('/presentaciones')} />
              {verRevision ? <BotonGrande texto="Revisión de factor" borde color={MARCA.ambar} onPress={() => router.push('/producto/revision-factor')} /> : null}
              <BotonGrande texto="Enriquecer SRS" borde color={MARCA.violetaClaro} onPress={() => router.push('/producto/enriquecer-srs')} />
            </View>
            <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'activos', label: 'Activos' }, { id: 'todos', label: 'Todos' }]} />
            {resumen.aproximado && busqueda ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran productos parecidos." /></View> : null}
            {resumen.total != null ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${resumen.total.toLocaleString('es-SV')} producto${resumen.total === 1 ? '' : 's'}`}</Text>
            ) : null}
          </View>
        )} />
      </TrasLaTransicion>
    </>
  );
}
