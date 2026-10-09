// La lista larga de la app: VIRTUALIZADA y con carga por páginas desde la base.
//
// Hasta acá las listas largas eran un `ScrollView` con `.map()` y un «Ver 50
// más» que sólo pintaba más de lo que ya se había bajado — o sea que la
// consulta traía todo (o los primeros 1000, que es peor: CLAUDE.md, «un tope
// se aplica ANTES del filtro») y el teléfono montaba cada fila aunque no se
// viera. Esta pieza pide a la base de a `porPagina`, monta sólo lo que está en
// pantalla (`FlatList`) y pide la siguiente página al acercarse al final.
//
// Trae los cuatro estados que toda lista necesita y que cada pantalla escribía
// a mano —o se olvidaba—: cargando, vacío, error con «Reintentar», y el
// pie «cargando más». Tirar hacia abajo recarga desde la primera página.
//
// En tableta reparte en columnas (`useColumnas`): una fila de teléfono
// estirada a 1024 pt es ilegible.
//
// Uso:
//   <ListaPaginada
//     cargarPagina={(desdeFila, porPagina) => promesa de filas}
//     dependencias={[filtro, texto]}   // al cambiar, vuelve a la página 1
//     renderItem={(fila) => <Ficha …/>}
//     keyExtractor={(f) => f.id}
//     cabecera={<Segmentos …/>}
//     vacio="Sin registros en este período" />
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View, useWindowDimensions } from 'react-native';
import { colorSistema } from './Formulario';
import { BotonGrande } from './formulario/Piezas';

/** Cuántas columnas caben con un ancho mínimo por tarjeta (1 en teléfono). */
export function useColumnas(minAncho = 360, maximo = 3) {
  const { width } = useWindowDimensions();
  return Math.max(1, Math.min(maximo, Math.floor((width - 16) / minAncho)));
}

/** Estado de error común: el mensaje y un botón que vuelve a intentar. */
export function ErrorConReintento({ mensaje, onReintentar }) {
  return (
    <View style={{ marginHorizontal: 16, marginTop: 24, gap: 12, alignItems: 'center' }}>
      <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>No se pudo cargar</Text>
      {mensaje ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>{mensaje}</Text> : null}
      {onReintentar ? <View style={{ alignSelf: 'stretch' }}><BotonGrande borde texto="Reintentar" onPress={onReintentar} /></View> : null}
    </View>
  );
}

export default function ListaPaginada({
  cargarPagina, porPagina = 50, dependencias = [], renderItem, keyExtractor,
  cabecera = null, vacio = 'Sin resultados', minAnchoColumna = 360,
  alCargar, // recibe TODAS las filas cargadas hasta ahora, después de cada página
}) {
  const columnas = useColumnas(minAnchoColumna);
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [error, setError] = useState('');
  const [hayMas, setHayMas] = useState(true);
  const [masCargando, setMasCargando] = useState(false);
  const [recargando, setRecargando] = useState(false);
  // Cada carga lleva su número: si el filtro cambió mientras la página venía en
  // camino, la respuesta vieja no pisa la lista nueva.
  const turno = useRef(0);
  // La función de la pantalla puede cambiar en cada render (una flecha en
  // línea): se lee del ref para que eso NO dispare una recarga en bucle. Lo
  // que reinicia la lista es `dependencias`, y nada más.
  const cargarRef = useRef(cargarPagina);
  const alCargarRef = useRef(alCargar);
  useEffect(() => { cargarRef.current = cargarPagina; alCargarRef.current = alCargar; });

  const pedir = useCallback(async (desdeFila) => {
    const r = await cargarRef.current(desdeFila, porPagina);
    if (r && r.error) throw r.error;
    return Array.isArray(r) ? r : (r?.data ?? []);
  }, [porPagina]);

  const desdeCero = useCallback(async () => {
    const mio = ++turno.current;
    setError('');
    try {
      const pagina = await pedir(0);
      if (mio !== turno.current) return;
      setFilas(pagina); setHayMas(pagina.length === porPagina); setEstado('listo');
      alCargarRef.current?.(pagina);
    } catch (e) {
      if (mio !== turno.current) return;
      setError(e?.message || ''); setEstado('error');
    }
  }, [pedir, porPagina]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `dependencias` es la lista que decide la pantalla
  useEffect(() => { setEstado('cargando'); setFilas([]); desdeCero(); }, [desdeCero, ...dependencias]);

  const siguiente = async () => {
    if (!hayMas || masCargando || estado !== 'listo') return;
    const mio = turno.current;
    setMasCargando(true);
    try {
      const pagina = await pedir(filas.length);
      if (mio !== turno.current) return;
      const todas = filas.concat(pagina);
      setFilas(todas); setHayMas(pagina.length === porPagina);
      alCargarRef.current?.(todas);
    } catch (e) { if (mio === turno.current) setError(e?.message || ''); }
    finally { setMasCargando(false); }
  };

  const pie = masCargando ? <ActivityIndicator style={{ marginVertical: 16 }} />
    : error && estado === 'listo' ? <ErrorConReintento mensaje={error} onReintentar={siguiente} />
      : <View style={{ height: 48 }} />;

  return (
    <FlatList
      key={`col-${columnas}`}
      data={filas}
      numColumns={columnas}
      columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
      renderItem={({ item, index }) => (
        <View style={columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }}>{renderItem(item, index)}</View>
      )}
      keyExtractor={keyExtractor ?? ((f, i) => String(f?.id ?? i))}
      ListHeaderComponent={cabecera}
      ListEmptyComponent={estado === 'cargando' ? <ActivityIndicator style={{ marginTop: 32 }} />
        : estado === 'error' ? <ErrorConReintento mensaje={error} onReintentar={() => { setEstado('cargando'); desdeCero(); }} />
          : <Text style={{ color: colorSistema.texto2, fontSize: 16, textAlign: 'center', marginTop: 40, marginHorizontal: 24 }}>{vacio}</Text>}
      ListFooterComponent={pie}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      contentContainerStyle={{ paddingTop: 12 }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      onEndReached={siguiente}
      onEndReachedThreshold={0.6}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={9}
      removeClippedSubviews
      refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await desdeCero(); setRecargando(false); }} />}
    />
  );
}

/**
 * Para las listas que ya bajaron todo (por los contadores y filtros, igual que
 * el portal) y pintan de a página con «Ver más»: al acercarse al final del
 * `ScrollView` pinta la siguiente sola, sin tocar el botón. El botón se queda
 * como respaldo (lector de pantalla, o una pantalla que no llega a desplazarse).
 *
 *   const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA), hayMas);
 *   <ScrollView {...alFinal} …>
 */
export function useMasAlFinal(alLlegar, hayMas = true, margen = 600) {
  const ultimo = useRef(0);
  const ref = useRef(alLlegar);
  useEffect(() => { ref.current = alLlegar; });
  return {
    scrollEventThrottle: 200,
    onScroll: ({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
      if (!hayMas) return;
      // Si la lista se achicó (otro filtro), se vuelve a armar desde cero.
      if (contentSize.height < ultimo.current) ultimo.current = 0;
      if (layoutMeasurement.height + contentOffset.y < contentSize.height - margen) return;
      // Una sola página por cada crecimiento del contenido: sin esto, el mismo
      // tramo final dispara varias veces antes de que la página nueva se pinte.
      if (contentSize.height <= ultimo.current) return;
      ultimo.current = contentSize.height;
      ref.current();
    },
  };
}
