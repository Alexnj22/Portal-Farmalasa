// El banner de promociones (2026-10-07): arriba del catálogo, en tarjetas
// grandes que se pasan con el dedo. Los banners se suben en el portal
// (Ofertas para clientes → Banners, 1200 × 500 px); mientras no haya ninguno
// vigente, se muestran las ofertas publicadas, así nunca queda vacío.
//
// No avanza solo: un carrusel que se mueve mientras uno lee distrae y gasta
// batería. Los puntos de abajo dicen cuántas hay.
import { memo, useCallback, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Presionable from './Presionable';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { Image as ImagenCache } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useOfertas } from '../lib/ofertas';
import { llamar } from '../lib/api';
import { colorSistema } from './sistema';
import { acentoDe, useTema } from '../tema/tema';
import { navegar } from '../lib/navegar';
import { useSesion } from '../lib/sesion';

let ultimos = null;
let pedidosAt = 0;
let pedidosPara = null;

// Fuera del render: un componente creado en cada render se desmonta y monta de
// nuevo entre banner y banner (2026-10-15).
function Separador() { return <View style={{ width: 10 }} />; }

// `memo`: no recibe props, así que el catálogo puede redibujarse (cada tecla
// de la búsqueda) sin arrastrar el carrusel.
export default memo(function BannerPromos({ titulo = null }) {
  const t = useTema();
  const { width } = useWindowDimensions();
  const { datos, cargar } = useOfertas();
  // El desplazamiento, en el hilo de la interfaz: los puntos lo siguen con el
  // dedo, sin saltar al soltar (usuario, 2026-10-07).
  const x = useSharedValue(0);
  const alDesplazar = useAnimatedScrollHandler((e) => { x.value = e.contentOffset.x; });
  const [banners, setBanners] = useState(null);
  const token = useSesion((x) => x.token);
  const pedir = useSesion((x) => x.pedir);
  useFocusEffect(useCallback(() => {
    cargar();
    // A lo sumo una vez por minuto: cada pedido firma las fotos otra vez.
    if (Date.now() - pedidosAt < 60_000 && ultimos && pedidosPara === token) { setBanners(ultimos); return; }
    // Con sesión se piden con las MUESTRAS de la ficha (2026-11-05, como las
    // historias); si eso falla, los públicos.
    const pedido = token ? pedir('banners_mios').then((r) => (r?.ok ? r : llamar('banners'))) : llamar('banners');
    pedido.then((r) => { if (r?.ok) { ultimos = r.banners; pedidosAt = Date.now(); pedidosPara = token; setBanners(r.banners); } });
  }, [cargar, token, pedir]));

  // Los del portal; si no hay, las ofertas (con su etiqueta y título encima).
  const publicadas = banners?.length
    ? banners.map((b) => ({ id: b.id, titulo: b.titulo, imagen: b.imagen, imagen_clave: b.imagen_clave,
        etiqueta: null, mostrarTitulo: b.titulo_visible, destino: b.oferta_id ? `/oferta/${b.oferta_id}` : b.enlace }))
    : (datos?.ofertas ?? []).filter((o) => o.disponible !== false).slice(0, 8)
        .map((o) => ({ ...o, mostrarTitulo: true, destino: `/oferta/${o.id}` }));
  // Sólo lo publicado (2026-11-11, usuario: «quita los placeholders»): sin
  // banners ni ofertas publicadas, el carrusel no aparece. Antes (2026-11-05)
  // se rellenaba con los productos de más descuento.
  const ofertas = publicadas;
  if (!ofertas.length) return null;
  const ancho = Math.min(width, 720) - 32;

  return (
    <View style={{ gap: 8 }}>
      {titulo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}>
          <Text accessibilityRole="header" style={{ flex: 1, fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{titulo}</Text>
          {/* El carril de ofertas ya no está: por aquí se llega a todas. */}
          {datos?.ofertas?.length ? (
            <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar('/ofertas'); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Ver todas las promociones"
              style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', paddingHorizontal: 6, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>Ver todas</Text>
            </Presionable>
          ) : null}
        </View>
      ) : null}
      <Animated.FlatList
        data={ofertas}
        keyExtractor={(o) => String(o.id)}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={ancho + 10}
        showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={Separador}
        onScroll={alDesplazar}
        scrollEventThrottle={16}
        renderItem={({ item: o }) => {
          const a = acentoDe(t, o.acento);
          // El banner del portal ya trae su diseño: proporción 2.4 : 1, como se subió.
          return (
            <Presionable onPress={() => { if (!o.destino) return; Haptics.selectionAsync().catch(() => {}); navegar(o.destino); }}
              accessibilityRole="button" accessibilityLabel={`Oferta: ${o.titulo}`}
              // minHeight y no height: con letra grande la etiqueta, el título y «Ver
              // más» no caben en la proporción del banner y quedaban cortados.
              style={({ pressed }) => ({ width: ancho, minHeight: Math.round(ancho / 2.4), borderRadius: 24, overflow: 'hidden', transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              {o.imagen ? (
                <ImagenCache source={{ uri: o.imagen, cacheKey: o.imagen_clave ?? undefined }} cachePolicy="memory-disk"
                  contentFit="cover" transition={150} style={StyleSheet.absoluteFill} />
              ) : (
                <LinearGradient colors={[a.fuerte, '#2B0B3A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              )}
              {o.mostrarTitulo ? (
              <>
              <LinearGradient colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.7)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill} />
              <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'flex-end', padding: 18, gap: 4 }}>
                {o.etiqueta ? (
                  <View style={{ backgroundColor: a.fuerte, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                    <Text maxFontSizeMultiplier={1.2} style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900' }}>{o.etiqueta}</Text>
                  </View>
                ) : null}
                <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900', textAlign: 'right', letterSpacing: -0.3, maxWidth: '75%' }} numberOfLines={2}>
                  {o.titulo}
                </Text>
                {o.destino ? <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' }}>Ver más ›</Text> : null}
              </View>
              </>
              ) : null}
            </Presionable>
          );
        }}
      />
      {ofertas.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {ofertas.map((o, i) => <Punto key={o.id} i={i} x={x} paso={ancho + 10} />)}
        </View>
      ) : null}
    </View>
  );
});

// Un punto del indicador: se ensancha y se aclara según cuánto se ve su banner.
function Punto({ i, x, paso }) {
  const estilo = useAnimatedStyle(() => {
    const p = x.value / paso;
    return {
      width: interpolate(p, [i - 1, i, i + 1], [6, 18, 6], Extrapolation.CLAMP),
      opacity: interpolate(p, [i - 1, i, i + 1], [0.35, 1, 0.35], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: colorSistema.texto2 }, estilo]} />;
}
