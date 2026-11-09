// El catálogo (2026-10-07): todos los productos con su precio de viñeta y su
// precio VIP —el que paga el socio—, y si hay en alguna sucursal. Sin buscar,
// sólo las filas (promociones, necesidades, mejores precios, laboratorios y
// vistos; 2026-11-09, sin el listado completo). Con el buscador, por nombre o
// principio activo. Al tocar un producto se abre su ficha.
//
// Carga CONTINUA (2026-10-20): al acercarse al final se piden los siguientes y
// se agregan abajo. Antes eran páginas de 20 con «Anterior / Siguiente»
// (usuario, 2026-10-07: «una lista infinita no es bonito»); el 2026-10-20 el
// usuario pidió el cambio: en el teléfono el botón chico obliga a apuntar y
// volver de una ficha dejaba la página en otro lugar.
//
// Las tarjetas NO son de vidrio: son muchas en una lista que se desplaza, y el
// vidrio de iOS 26 cuesta por cada una. Un fondo translúcido sólido se ve igual
// de limpio y se desplaza fluido.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Platform, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import FilaLaboratorios from '../../../componentes/FilaLaboratorios';
import Presionable from '../../../componentes/Presionable';
import { Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colorSistema } from '../../../componentes/sistema';
import { ESPACIO_BURBUJA, Vacio } from '../../../componentes/ui';
import Icono from '../../../componentes/Icono';
import Vidrio from '../../../componentes/Vidrio';
import FotoProducto from '../../../componentes/FotoProducto';
import BannerPromos from '../../../componentes/BannerPromos';
import FilaProductos from '../../../componentes/FilaProductos';
import BotonAgregar from '../../../componentes/BotonAgregar';
import HojaAgregar, { AvisoAgregado } from '../../../componentes/HojaAgregar';
import { Entrada } from '../../../componentes/animacion';
import { llamar } from '../../../lib/api';
import { dolares } from '../../../lib/formato';
import { BUSQUEDAS, alCambiarVistos, leerVistos, vistosEnMemoria, nombreProducto, olvidarVistos } from '../../../lib/catalogo';
import { suave, useTema } from '../../../tema/tema';
import { navegar } from '../../../lib/navegar';
// Precio de mayoreo (2026-10-12): el catálogo se pide con la sesión, y a quien
// le corresponde el servidor le agrega `precio_tuyo` (lib/precioTuyo.js).
import { datosDePrecio, precioFinal, rotuloPrecioTuyo } from '../../../lib/precioTuyo';

// Cuántos trae cada «Ver más productos».
const POR_TANDA = 30;
const ALTO_BUSCADOR = 46;
// El servidor no pasa de `desde = 1000` (app-clientes, acción `catalogo`): una
// tanda que empiece más allá devuelve la misma de antes (2026-10-12). Ahí la
// lista se detiene: 1,000 productos es más de lo que alguien recorre a dedo;
// lo demás se encuentra buscando.
const DESDE_MAX = 1000;
// Sin buscar, la primera tanda se pide de 50 (el tope del servidor): de esas
// mismas salen la lista y la fila «Mayor ahorro», en un solo pedido (2026-10-15).
const PRIMERA_SIN_BUSCAR = 50;

// Los de mayor ahorro VIP (en %), de los que hay en existencia.
function mayorAhorro(productos) {
  return productos.filter((p) => p.precio_vip != null && p.disponible)
    .sort((a, b) => (b.precio - b.precio_vip) / b.precio - (a.precio - a.precio_vip) / a.precio).slice(0, 10);
}

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
  // Desde dónde se pide la tanda siguiente (= cuántos hay en la lista).
  const [desde, setDesde] = useState(0);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  // Los laboratorios de la fila (vienen con la primera tanda sin buscar) y el
  // elegido: se busca como `lab:<id>` (app_catalogo, 2026-11-05).
  const [labs, setLabs] = useState([]);
  const [lab, setLab] = useState(null);
  // Los laboratorios cuyo nombre coincide con lo buscado, con su logo.
  const [labsHallados, setLabsHallados] = useState([]);
  // La lista ya no se alarga sola al llegar al final (usuario, 2026-11-05: «que
  // sea una lista interminable se me hace mucho, no tengo opción de volver
  // arriba de forma fácil»): crece con «Ver más productos», y pasada la
  // primera pantalla y media aparece «Arriba» en la barra.
  const listaRef = useRef(null);
  const [lejos, setLejos] = useState(false);
  const { height: altoPantalla } = useWindowDimensions();
  // El buscador va encima de la lista y se pega arriba al desplazar (2026-11-09).
  // Es una sola pieza, fuera de la lista: así nunca pierde el foco ni el teclado.
  // En iOS la barra es transparente y la lista corre debajo; en Android, no.
  const altoBarra = useHeaderHeight();
  const tope = Platform.OS === 'ios' ? altoBarra : 0;
  const desplazado = useSharedValue(null);
  const posBuscador = useSharedValue(null);
  const yaLejos = useSharedValue(false);
  const alDesplazar = useAnimatedScrollHandler((e) => {
    const y = e.contentOffset.y;
    desplazado.value = y;
    const ahora = yaLejos.value ? y > altoPantalla : y > altoPantalla * 1.5;
    if (ahora !== yaLejos.value) { yaLejos.value = ahora; runOnJS(setLejos)(ahora); }
  }, [altoPantalla]);
  const estiloBuscador = useAnimatedStyle(() => {
    // Fuera de pantalla y no con opacidad: el Liquid Glass a veces no se dibuja bajo un fundido.
    if (posBuscador.value == null) return { transform: [{ translateY: -200 }] };
    const d = desplazado.value;
    return { transform: [{ translateY: d == null ? posBuscador.value + tope : Math.max(tope + 6, posBuscador.value - d) }] };
  }, [tope]);
  const arriba = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    listaRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);
  const pedido = useRef(0);
  // `onEndReached` puede dispararse varias veces seguidas: el estado llega
  // tarde para frenarlo, la referencia no.
  const pidiendoMas = useRef(false);
  // Las filas de arriba (sin buscar): mayor ahorro VIP y vistos recientemente.
  const [ahorro, setAhorro] = useState([]);
  // Nace con la copia en memoria (lib/catalogo.js); al volver a la pestaña,
  // sólo cambia si cambió de verdad — el mismo arreglo no repinta la fila.
  const [vistos, setVistos] = useState(vistosEnMemoria);
  useEffect(() => {
    leerVistos().then(setVistos);
    return alCambiarVistos(setVistos);
  }, []);

  // Escribir otra cosa (o tocar una categoría) suelta el laboratorio.
  const labActivo = lab && texto === `lab:${lab.id}` ? lab : null;
  const elegirLab = useCallback((l) => {
    Haptics.selectionAsync().catch(() => {});
    if (labActivo?.id === l.id) { setTexto(''); return; }
    setLab(l); setTexto(`lab:${l.id}`);
    listaRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [labActivo]);
  // La búsqueda sale 300 ms después de la última tecla.
  useEffect(() => { const id = setTimeout(() => setQ(texto.trim()), 300); return () => clearTimeout(id); }, [texto]);

  // `inicio` 0 = empezar de nuevo (otra búsqueda, refrescar); si no, agregar.
  const cargar = useCallback(async (inicio, previa = []) => {
    const n = ++pedido.current;
    setError(false);
    const primera = inicio === 0 && !q;
    const r = await llamar('catalogo', { q, desde: inicio, limite: primera ? PRIMERA_SIN_BUSCAR : POR_TANDA, ...datosDePrecio() });
    if (n !== pedido.current) return; // llegó tarde: ya se pidió otra cosa
    if (!r?.ok) { setError(true); return; }
    const productos = r.productos ?? [];
    if (inicio === 0) setLabsHallados(r.labs_encontrados ?? []);
    if (primera) { setAhorro(mayorAhorro(productos)); if (r.laboratorios?.length) setLabs(r.laboratorios); }
    // Sin repetidos: entre una tanda y la otra el orden de «lo más vendido»
    // puede moverse, y una llave repetida rompe la lista.
    const ya = new Set(previa.map((p) => p.id));
    const nueva = previa.concat(productos.filter((p) => !ya.has(p.id)));
    const siguiente = inicio + productos.length;
    setLista(nueva);
    setDesde(siguiente);
    setHayMas(!!r.hay_mas && productos.length > 0 && siguiente < DESDE_MAX);
  }, [q]);
  // Otra búsqueda: de vuelta al principio.
  useEffect(() => { setLista(null); setHayMas(false); cargar(0); }, [cargar]);

  const cargarMas = useCallback(async () => {
    if (pidiendoMas.current || !hayMas || error || !lista?.length) return;
    pidiendoMas.current = true;
    setCargandoMas(true);
    await cargar(desde, lista);
    setCargandoMas(false);
    pidiendoMas.current = false;
  }, [hayMas, error, lista, desde, cargar]);
  // Deslizar hacia abajo vuelve a empezar (2026-10-12): si la primera carga
  // fallaba no había forma de reintentar.
  const refrescar = async () => { setRefrescando(true); await cargar(0); setRefrescando(false); };

  // El encabezado en piezas memorizadas (2026-10-15): cada tecla cambia
  // `texto` y redibuja la pantalla; sólo las categorías dependen de él (su
  // marca de activa), así que el carrusel y las filas no se rehacen.
  const filas = useMemo(() => (q ? null : (
    <>
      <FilaProductos titulo="Mejores precios" sf="tag.fill" productos={ahorro} />
      <FilaLaboratorios labs={labs} alElegir={elegirLab} />
      <FilaProductos titulo="Vistos recientemente" sf="clock.arrow.circlepath" productos={vistos}
        accion={{ texto: 'Limpiar', alTocar: olvidarVistos }} />
    </>
  )), [q, ahorro, vistos, labs, elegirLab]);
  // Compra por necesidad (2026-11-09): mosaicos con su ícono, con el color de
  // la marca; tocar uno busca y tocarlo otra vez lo quita. Vuelven a ser
  // mosaicos porque las píldoras se perdían entre las demás filas.
  const categorias = useMemo(() => (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ marginLeft: 4, fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>¿Qué necesitas?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
        {BUSQUEDAS.map((b) => {
          const activa = q === b.q && texto === b.q;
          return (
            <Presionable key={b.q} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTexto(activa ? '' : b.q); }}
              accessibilityRole="button" accessibilityLabel={b.texto} accessibilityState={{ selected: activa }}
              style={({ pressed }) => ({ width: 82, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <View style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                backgroundColor: activa ? t.color.magenta : suave(t.color.magenta, t.oscuro ? 0.26 : 0.12) }}>
                <Icono sf={b.sf} respaldo="" tam={24} color={activa ? '#FFFFFF' : t.color.magentaTexto} />
              </View>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ fontSize: 12, lineHeight: 15, fontWeight: activa ? '800' : '700', textAlign: 'center', color: colorSistema.texto }}>{b.texto}</Text>
            </Presionable>
          );
        })}
      </ScrollView>
    </View>
  ), [q, texto, t]);
  // Un laboratorio se busca como `lab:<id>`: eso no se le muestra a nadie.
  const valorBuscador = texto.startsWith('lab:') ? '' : texto;
  const necesidad = BUSQUEDAS.find((b) => b.q === q);
  const tituloFiltro = labActivo ? labActivo.nombre : necesidad ? necesidad.texto : `Resultados para «${q}»`;
  const volverALaTienda = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    Keyboard.dismiss();
    setTexto(''); setQ('');
    listaRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const encabezado = useMemo(() => (
    <View style={{ gap: 12, marginBottom: 6 }}>
      {/* Promociones arriba, el buscador siempre abierto debajo (2026-11-09: en
          Android la barra del sistema no salía abierta como en iOS). */}
      {!q ? <BannerPromos productos={ahorro} titulo="Promociones" /> : null}
      {/* El lugar que ocupa el buscador, que va fuera de la lista. */}
      <View style={{ height: ALTO_BUSCADOR }} onLayout={(e) => { posBuscador.value = e.nativeEvent.layout.y + 16; }} />
      {/* Filtrando (2026-11-09, «no sé cómo volver a la tienda»): una sola salida,
          la misma para búsqueda, necesidad y laboratorio, pegada al buscador. */}
      {q ? (
        <View style={{ gap: 6 }}>
          <Presionable onPress={volverALaTienda} accessibilityRole="button" accessibilityLabel="Volver a la tienda"
            style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 999,
              backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.12), transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Icono sf="chevron.left" respaldo="‹" tam={13} color={t.color.magentaTexto} />
            <Text style={{ fontSize: 15, fontWeight: '800', color: t.color.magentaTexto }}>Volver a la tienda</Text>
          </Presionable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 4 }}>
            {labActivo?.foto ? (
              <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
                <Image source={{ uri: labActivo.foto }} resizeMode="contain" style={{ width: 38, height: 38 }} accessible={false} />
              </View>
            ) : null}
            <Text accessibilityRole="header" numberOfLines={2} style={{ flex: 1, fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>{tituloFiltro}</Text>
          </View>
          {!labActivo ? <FilaLaboratorios labs={labsHallados} alElegir={elegirLab} /> : null}
        </View>
      ) : (
        <>
          {categorias}
          {filas}
        </>
      )}
    </View>
  ), [q, tituloFiltro, volverALaTienda, categorias, filas, t, ahorro, labActivo, labsHallados, elegirLab]);
  // Estable: con una función nueva en cada render, la lista redibujaba todas
  // las tarjetas a cada tecla.
  const renderItem = useCallback(({ item, index }) => {
    const tarjeta = <TarjetaProducto p={item} />;
    const celda = { flex: 1, maxWidth: columnas === 1 ? '100%' : '50%' };
    // Sólo la primera pantalla entra escalonada; lo demás aparece sin esperar.
    return index < 6 ? <Entrada indice={index} estilo={celda}>{tarjeta}</Entrada> : <View style={celda}>{tarjeta}</View>;
  }, [columnas]);

  return (
    <>
      <Stack.Screen options={{
        // A la izquierda: la derecha es de la campana del encabezado.
        headerLeft: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {lejos ? (
          <Presionable onPress={arriba} hitSlop={8} accessibilityRole="button" accessibilityLabel="Volver arriba"
            style={({ pressed }) => ({ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, opacity: pressed ? 0.6 : 1 })}>
            <Icono sf="arrow.up" respaldo="↑" tam={14} color={t.color.magentaTexto} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Arriba</Text>
          </Presionable>
            ) : null}
            {Platform.OS !== 'web' ? (
              <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar('/escaner'); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Escanear un producto"
                style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Icono sf="barcode.viewfinder" respaldo="▮" tam={22} color={t.color.magentaTexto} />
              </Presionable>
            ) : null}
          </View>
        ),
      }} />
      <Animated.FlatList
        ref={listaRef}
        onScroll={alDesplazar}
        scrollEventThrottle={16}
        // Cambiar `numColumns` exige montar la lista de nuevo.
        key={`col${columnas}`}
        data={q ? (lista ?? []) : []}
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
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
        ListEmptyComponent={
          error ? (
            <Vacio titulo="No se pudo cargar" accion="Reintentar" alAccion={() => { setLista(null); cargar(0); }}>
              Revisa tu conexión e intenta de nuevo.
            </Vacio>
          )
            : !lista ? <ActivityIndicator style={{ marginTop: 40 }} />
              : !q ? null : <Vacio titulo="Sin resultados" icono="magnifyingglass" respaldo="⌕">Prueba con otro nombre o con el principio activo.</Vacio>
        }
        ListFooterComponent={!q || !lista?.length ? null
          // Pedir más falló: lo cargado se queda, se dice y se puede reintentar.
          : error ? <Reintentar alTocar={() => { setError(false); cargar(desde, lista); }} />
            : cargandoMas ? <ActivityIndicator style={{ marginVertical: 16 }} />
              : hayMas ? <VerMas alTocar={cargarMas} />
                : lista.length > 12 ? <VerMas texto="Volver arriba" sf="arrow.up" alTocar={arriba} />
                  : null}
      />
      <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, alignItems: 'center', zIndex: 10 }, estiloBuscador]}>
        <Buscador valor={valorBuscador} alCambiar={setTexto} />
      </Animated.View>
      <HojaAgregar />
      <AvisoAgregado />
    </>
  );
}

// `memo`: con el mismo producto no se redibuja al escribir en la búsqueda.
const TarjetaProducto = memo(function TarjetaProducto({ p }) {
  const t = useTema();
  const final = precioFinal(p);
  const ahorro = final < p.precio ? p.precio - final : 0;
  const suyo = rotuloPrecioTuyo(p);
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar(`/producto/${p.id}`); }}
      // La etiqueta dice lo mismo que se VE (2026-11-04): «Sin existencia» y
      // «Bajo Receta» se pintaban pero el lector de pantalla no los leía, y el
      // descuento tampoco.
      accessibilityRole="button" accessibilityLabel={[
        nombreProducto(p.nombre),
        p.bajo_receta ? 'Bajo Receta' : null,
        p.disponible ? null : 'Sin existencia',
        `Precio ${dolares(p.precio)}${suyo ? `, ${suyo} ${dolares(p.precio_tuyo)}` : p.precio_vip != null ? `, Preferente ${dolares(p.precio_vip)}` : ''}`,
        ahorro >= 0.01 ? `${Math.round((ahorro / p.precio) * 100)}% de descuento` : null,
      ].filter(Boolean).join('. ')}
      style={({ pressed }) => ({ flex: 1, borderRadius: 22, padding: 10, gap: 8,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.82)',
        borderWidth: 0.5, borderColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
        opacity: p.disponible ? 1 : 0.6, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View>
        <FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={118} />
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
        <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto, lineHeight: 18 }}>{nombreProducto(p.nombre)}</Text>
        {/* El precio es el de la presentación MAYOR (la caja); si hay más, se dice. */}
        <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>
          {p.disponible ? nombreProducto(p.presentacion || 'Unidad') : 'Sin existencia'}
        </Text>
        {p.presentaciones > 1 ? (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, borderRadius: 999,
            paddingHorizontal: 8, paddingVertical: 3, backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.12) }}>
            <Icono sf="square.stack.3d.up.fill" respaldo="" tam={10} color={t.color.magentaTexto} />
            <Text maxFontSizeMultiplier={1.2} style={{ flexShrink: 1, fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>
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
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 10, fontWeight: '800', color: t.color.magentaTexto }}>{suyo}</Text>
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
      {/* Al fondo de la tarjeta: los botones de una fila quedan alineados. */}
      <View style={{ flex: 1 }} />
      <BotonAgregar p={p} bloque />
    </Presionable>
  );
});

// El buscador, siempre abierto y dentro de la lista, igual en iOS y Android.
const Buscador = memo(function Buscador({ valor, alCambiar }) {
  return (
    // Vidrio en iOS, superficie opaca en Android: los productos pasan por debajo.
    <Vidrio radio={ALTO_BUSCADOR / 2} elevacion={3} style={{ width: '100%', maxWidth: 688, height: ALTO_BUSCADOR, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4 }}>
      <Icono sf="magnifyingglass" respaldo="⌕" tam={16} color={colorSistema.texto3} />
      <TextInput value={valor} onChangeText={alCambiar} placeholder="Medicamento o principio activo" placeholderTextColor={colorSistema.texto3}
        accessibilityLabel="Buscar medicamento o principio activo" returnKeyType="search" autoCapitalize="none" autoCorrect={false}
        style={{ flex: 1, fontSize: 16, color: colorSistema.texto, paddingVertical: 0 }} />
      {valor ? (
        <Presionable onPress={() => alCambiar('')} accessibilityRole="button" accessibilityLabel="Borrar búsqueda"
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Icono sf="xmark.circle.fill" respaldo="×" tam={18} color={colorSistema.texto3} />
        </Presionable>
      ) : null}
    </Vidrio>
  );
});

// Tanda siguiente fallida: aviso y botón, sin perder lo que ya se ve.
function Reintentar({ alTocar }) {
  const t = useTema();
  return (
    <View style={{ alignItems: 'center', gap: 8, marginTop: 8 }}>
      <Text style={{ fontSize: 13, color: t.color.avisoTexto, textAlign: 'center' }}>No se pudieron cargar más productos. Revisa tu conexión.</Text>
      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button" accessibilityLabel="Reintentar"
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center',
          backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>Reintentar</Text>
      </Presionable>
    </View>
  );
}

// El pie de la lista (2026-11-05): «Ver más productos» en vez de cargar solo,
// y al final de todo, «Volver arriba».
function VerMas({ texto = 'Ver más productos', sf = 'chevron.down', alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button"
      style={({ pressed }) => ({ alignSelf: 'center', marginVertical: 14, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, borderRadius: 999, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.9)',
        borderWidth: 0.5, borderColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>{texto}</Text>
      <Icono sf={sf} respaldo="" tam={12} color={t.color.magentaTexto} />
    </Presionable>
  );
}
