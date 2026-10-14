// El catálogo (2026-10-07): todos los productos con su precio de viñeta y su
// precio VIP —el que paga el socio—, y si hay en alguna sucursal. Sin buscar,
// lo más vendido de los últimos 60 días; con la barra del sistema, por nombre
// o principio activo. Al tocar un producto se abre su ficha. Por PÁGINAS de 20
// con «Anterior / Siguiente» abajo (usuario, 2026-10-07: «una lista infinita
// no es bonito»).
//
// Las tarjetas NO son de vidrio: son muchas en una lista que se desplaza, y el
// vidrio de iOS 26 cuesta por cada una. Un fondo translúcido sólido se ve igual
// de limpio y se desplaza fluido.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Presionable from '../../../componentes/Presionable';
import { useFocusEffect, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colorSistema } from '../../../componentes/sistema';
import { ESPACIO_BURBUJA, RADIO, Seccion, Vacio } from '../../../componentes/ui';
import Icono from '../../../componentes/Icono';
import FotoProducto from '../../../componentes/FotoProducto';
import BannerPromos from '../../../componentes/BannerPromos';
import FilaProductos from '../../../componentes/FilaProductos';
import { llamar } from '../../../lib/api';
import { dolares } from '../../../lib/formato';
import { BUSQUEDAS, leerVistos, nombreProducto, olvidarVistos, tonoDe } from '../../../lib/catalogo';
import { LinearGradient } from 'expo-linear-gradient';
import { suave, useTema } from '../../../tema/tema';
import { navegar } from '../../../lib/navegar';
// Precio de mayoreo (2026-10-12): el catálogo se pide con la sesión, y a quien
// le corresponde el servidor le agrega `precio_tuyo` (lib/precioTuyo.js).
import { datosDePrecio, precioFinal, rotuloPrecioTuyo } from '../../../lib/precioTuyo';

const POR_PAGINA = 20;
// El servidor no pasa de `desde = 1000` (app-clientes, acción `catalogo`): una
// página que empiece más allá devolvía la misma de antes y «Siguiente» quedaba
// trabado desde la página 51 (2026-10-12).
const DESDE_MAX = 1000;

export default function Catalogo() {
  const t = useTema();
  // Con letra grande (2026-10-13), dos columnas dejaban el nombre en tres
  // letras por línea y el precio cortado: pasa a una sola columna.
  const { fontScale } = useWindowDimensions();
  const columnas = fontScale > 1.3 ? 1 : 2;
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState(null);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [cambiando, setCambiando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const pedido = useRef(0);
  const listaRef = useRef(null);
  // Las filas de arriba (sin buscar): mayor ahorro VIP y vistos recientemente.
  const [ahorro, setAhorro] = useState([]);
  const [vistos, setVistos] = useState([]);
  useEffect(() => {
    llamar('catalogo', { q: '', desde: 0, limite: 50, ...datosDePrecio() }).then((r) => {
      if (!r?.ok) return;
      setAhorro(r.productos.filter((p) => p.precio_vip != null && p.disponible)
        .sort((a, b) => (b.precio - b.precio_vip) / b.precio - (a.precio - a.precio_vip) / a.precio).slice(0, 10));
    });
  }, []);
  useFocusEffect(useCallback(() => { leerVistos().then(setVistos); }, []));

  // La búsqueda sale 300 ms después de la última tecla.
  useEffect(() => { const id = setTimeout(() => setQ(texto.trim()), 300); return () => clearTimeout(id); }, [texto]);

  const cargar = useCallback(async (p) => {
    const n = ++pedido.current;
    setError(false);
    const r = await llamar('catalogo', { q, desde: p * POR_PAGINA, limite: POR_PAGINA, ...datosDePrecio() });
    if (n !== pedido.current) return; // llegó tarde: ya se pidió otra cosa
    if (!r?.ok) { setError(true); return; }
    setLista(r.productos);
    setHayMas(!!r.hay_mas && (p + 1) * POR_PAGINA <= DESDE_MAX);
    setPagina(p);
  }, [q]);
  // Otra búsqueda: de vuelta a la página 1.
  useEffect(() => { setLista(null); cargar(0); }, [cargar]);

  const irA = async (p) => {
    if (cambiando || p < 0) return;
    Haptics.selectionAsync().catch(() => {});
    setCambiando(true);
    await cargar(p);
    setCambiando(false);
    listaRef.current?.scrollToOffset({ offset: 0, animated: true });
  };
  // Deslizar hacia abajo vuelve a pedir la página que se ve (2026-10-12): si la
  // primera carga fallaba no había forma de reintentar.
  const refrescar = async () => { setRefrescando(true); await cargar(lista ? pagina : 0); setRefrescando(false); };

  const encabezado = (
    <View style={{ gap: 12, marginBottom: 6 }}>
      {/* Promociones arriba (las mismas ofertas del portal), sólo sin buscar. */}
      {!q ? <BannerPromos /> : null}
      {/* Categorías: mosaicos con su color y su ícono; tocar uno busca y
          tocarlo otra vez lo quita. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2, paddingVertical: 2 }}>
        {/* «Todo»: quita la categoría o la búsqueda y vuelve a lo más vendido. */}
        {(() => {
          const activa = !texto;
          return (
            <Presionable key="todo" onPress={() => { Haptics.selectionAsync().catch(() => {}); setTexto(''); }}
              accessibilityRole="button" accessibilityLabel="Todo, quitar el filtro" accessibilityState={{ selected: activa }}
              style={({ pressed }) => ({ width: 78, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <View style={{ padding: 2.5, borderRadius: 22, borderWidth: 2, borderColor: activa ? t.color.magenta : 'transparent' }}>
                <View style={{ width: 60, height: 60, borderRadius: RADIO.medio, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.07)' }}>
                  <Icono sf={activa ? 'square.grid.2x2.fill' : 'xmark'} respaldo="" tam={24} color={colorSistema.texto} />
                </View>
              </View>
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, lineHeight: 15, fontWeight: activa ? '800' : '600', textAlign: 'center', color: activa ? colorSistema.texto : colorSistema.texto2 }}>
                {activa ? 'Todo' : 'Quitar filtro'}
              </Text>
            </Presionable>
          );
        })()}
        {BUSQUEDAS.map((b, i) => {
          const activa = q === b.q && texto === b.q;
          const [c1, c2] = tonoDe(i);
          return (
            <Presionable key={b.q} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTexto(activa ? '' : b.q); }}
              accessibilityRole="button" accessibilityLabel={b.texto} accessibilityState={{ selected: activa }}
              style={({ pressed }) => ({ width: 78, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <View style={{ padding: 2.5, borderRadius: 22, borderWidth: 2, borderColor: activa ? t.color.magenta : 'transparent' }}>
                <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 60, height: 60, borderRadius: RADIO.medio, alignItems: 'center', justifyContent: 'center' }}>
                  <Icono sf={b.sf} respaldo="" tam={26} color="#FFFFFF" />
                </LinearGradient>
              </View>
              <Text numberOfLines={2} maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, lineHeight: 15, fontWeight: activa ? '800' : '600', textAlign: 'center', color: activa ? colorSistema.texto : colorSistema.texto2 }}>
                {b.texto}
              </Text>
            </Presionable>
          );
        })}
      </ScrollView>
      {/* Debajo de las categorías (usuario, 2026-10-07: «la categoría siempre abajo del banner»). */}
      {!q ? <FilaProductos titulo="Mayor ahorro con tu tarjeta de Puntos Salud" sf="tag.fill" productos={ahorro} /> : null}
      {!q ? <FilaProductos titulo="Vistos recientemente" sf="clock.arrow.circlepath" productos={vistos}
        accion={{ texto: 'Limpiar', alTocar: () => { olvidarVistos(); setVistos([]); } }} /> : null}
      <Seccion>{q ? `Resultados para «${q}»` : 'Lo más vendido'}</Seccion>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{
        headerSearchBarOptions: {
          placeholder: 'Medicamento o principio activo',
          cancelButtonText: 'Cancelar',
          hideWhenScrolling: false,
          autoCapitalize: 'none',
          onChangeText: (e) => setTexto(e.nativeEvent.text ?? ''),
          onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <FlatList
        ref={listaRef}
        // Cambiar `numColumns` exige montar la lista de nuevo.
        key={`col${columnas}`}
        data={lista ?? []}
        keyExtractor={(p) => String(p.id)}
        numColumns={columnas}
        columnWrapperStyle={columnas > 1 ? { gap: 12 } : undefined}
        // Abajo, el lugar de la burbuja del chat (2026-10-13).
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + (Platform.OS === 'web' ? 0 : ESPACIO_BURBUJA), gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={encabezado}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
        renderItem={({ item }) => <TarjetaProducto p={item} sola={columnas === 1} />}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
        ListEmptyComponent={
          error ? (
            <Vacio titulo="No se pudo cargar" accion="Reintentar" alAccion={() => { setLista(null); cargar(0); }}>
              Revisa tu conexión e intenta de nuevo.
            </Vacio>
          )
            : !lista ? <ActivityIndicator style={{ marginTop: 40 }} />
              : <Vacio titulo="Sin resultados" icono="magnifyingglass" respaldo="⌕">Prueba con otro nombre o con el principio activo.</Vacio>
        }
        ListFooterComponent={lista?.length && (pagina > 0 || hayMas || error) ? (
          <View style={{ gap: 8 }}>
            {/* Cambiar de página falló: la lista de antes se queda, pero se dice. */}
            {error ? <Text style={{ fontSize: 13, color: t.color.avisoTexto, textAlign: 'center' }}>No se pudo cargar esa página. Revisa tu conexión e intenta de nuevo.</Text> : null}
            {pagina > 0 || hayMas ? <Paginas pagina={pagina} hayMas={hayMas} cargando={cambiando} alAnterior={() => irA(pagina - 1)} alSiguiente={() => irA(pagina + 1)} /> : null}
          </View>
        ) : null}
      />
    </>
  );
}

function TarjetaProducto({ p, sola = false }) {
  const t = useTema();
  const final = precioFinal(p);
  const ahorro = final < p.precio ? p.precio - final : 0;
  const suyo = rotuloPrecioTuyo(p);
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar(`/producto/${p.id}`); }}
      accessibilityRole="button" accessibilityLabel={`${nombreProducto(p.nombre)}. Precio ${dolares(p.precio)}${suyo ? `, ${suyo} ${dolares(p.precio_tuyo)}` : p.precio_vip != null ? `, Preferente ${dolares(p.precio_vip)}` : ''}`}
      style={({ pressed }) => ({ flex: 1, maxWidth: sola ? '100%' : '50%', borderRadius: 22, padding: 10, gap: 8,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.82)',
        borderWidth: 0.5, borderColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
        opacity: p.disponible ? 1 : 0.6, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View>
        <FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={sola ? 160 : 118} />
        {p.bajo_receta ? (
          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text maxFontSizeMultiplier={1.2} style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>Bajo Receta</Text>
          </View>
        ) : null}
        {ahorro >= 0.01 ? (
          <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: t.color.verde, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text maxFontSizeMultiplier={1.2} style={{ color: '#1A2600', fontSize: 11, fontWeight: '900' }}>−{Math.round((ahorro / p.precio) * 100)}%</Text>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 2, paddingHorizontal: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto, lineHeight: 18 }} numberOfLines={2}>{nombreProducto(p.nombre)}</Text>
        {/* El precio es el de la presentación MAYOR (la caja); si hay más, se dice. */}
        <Text style={{ fontSize: 12, color: colorSistema.texto3 }} numberOfLines={1}>
          {p.disponible ? nombreProducto(p.presentacion || 'Unidad') : 'Sin existencia'}
        </Text>
        {p.presentaciones > 1 ? (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, borderRadius: 999,
            paddingHorizontal: 8, paddingVertical: 3, backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.12) }}>
            <Icono sf="square.stack.3d.up.fill" respaldo="" tam={10} color={t.color.magentaTexto} />
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>
              +{p.presentaciones - 1} {p.presentaciones - 1 === 1 ? 'presentación' : 'presentaciones'}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 0, paddingHorizontal: 2 }}>
        {suyo ? (
          <>
            <Text style={{ fontSize: 12, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>
              {dolares(p.precio)}
            </Text>
            <Text style={{ fontSize: 19, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(p.precio_tuyo)}</Text>
            <View style={{ alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.12) }}>
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 10, fontWeight: '800', color: t.color.magentaTexto }} numberOfLines={1}>{suyo}</Text>
            </View>
          </>
        ) : p.precio_vip != null ? (
          <>
            <Text style={{ fontSize: 12, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>
              {dolares(p.precio)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 5 }}>
              <Text style={{ fontSize: 19, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(p.precio_vip)}</Text>
              <Text style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>PREFERENTE</Text>
            </View>
          </>
        ) : (
          <Text style={{ fontSize: 19, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>
            {dolares(p.precio)}
          </Text>
        )}
      </View>
    </Presionable>
  );
}

// «‹ Anterior · Página 2 · Siguiente ›», como un paginador del sistema.
function Paginas({ pagina, hayMas, cargando, alAnterior, alSiguiente }) {
  const t = useTema();
  const boton = (habilitado) => ({ pressed }) => ({
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
    opacity: habilitado ? 1 : 0.35, transform: [{ scale: pressed && habilitado ? 0.96 : 1 }],
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
      <Presionable onPress={alAnterior} disabled={pagina === 0 || cargando} accessibilityRole="button" accessibilityLabel="Página anterior"
        style={boton(pagina > 0 && !cargando)}>
        <Icono sf="chevron.left" respaldo="‹" tam={13} color={colorSistema.texto} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>Anterior</Text>
      </Presionable>
      {cargando ? <ActivityIndicator /> : (
        <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>Página {pagina + 1}</Text>
      )}
      <Presionable onPress={alSiguiente} disabled={!hayMas || cargando} accessibilityRole="button" accessibilityLabel="Página siguiente"
        style={boton(hayMas && !cargando)}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>Siguiente</Text>
        <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto} />
      </Presionable>
    </View>
  );
}
