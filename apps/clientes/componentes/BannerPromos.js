// El banner de promociones (2026-10-07): arriba del catálogo, en tarjetas
// grandes que se pasan con el dedo. Los banners se suben en el portal
// (Ofertas para clientes → Banners, 1200 × 500 px); mientras no haya ninguno
// vigente, se muestran las ofertas publicadas, así nunca queda vacío.
//
// No avanza solo: un carrusel que se mueve mientras uno lee distrae y gasta
// batería. Los puntos de abajo dicen cuántas hay.
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Image as ImagenCache } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useOfertas } from '../lib/ofertas';
import { llamar } from '../lib/api';
import { colorSistema } from './sistema';
import { acentoDe, useTema } from '../tema/tema';

let ultimos = null;
let pedidosAt = 0;

export default function BannerPromos() {
  const t = useTema();
  const { width } = useWindowDimensions();
  const { datos, cargar } = useOfertas();
  const [pagina, setPagina] = useState(0);
  const [banners, setBanners] = useState(null);
  useFocusEffect(useCallback(() => {
    cargar();
    // A lo sumo una vez por minuto: cada pedido firma las fotos otra vez.
    if (Date.now() - pedidosAt < 60_000 && ultimos) { setBanners(ultimos); return; }
    llamar('banners').then((r) => { if (r?.ok) { ultimos = r.banners; pedidosAt = Date.now(); setBanners(r.banners); } });
  }, [cargar]));

  // Los del portal; si no hay, las ofertas (con su etiqueta y título encima).
  const ofertas = banners?.length
    ? banners.map((b) => ({ id: b.id, titulo: b.titulo, imagen: b.imagen, imagen_clave: b.imagen_clave,
        etiqueta: null, mostrarTitulo: b.titulo_visible, destino: b.oferta_id ? `/oferta/${b.oferta_id}` : b.enlace }))
    : (datos?.ofertas ?? []).filter((o) => o.disponible !== false).slice(0, 8)
        .map((o) => ({ ...o, mostrarTitulo: true, destino: `/oferta/${o.id}` }));
  if (!ofertas.length) return null;
  const ancho = Math.min(width, 720) - 32;

  return (
    <View style={{ gap: 8 }}>
      <FlatList
        data={ofertas}
        keyExtractor={(o) => String(o.id)}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={ancho + 10}
        showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
        onMomentumScrollEnd={(e) => setPagina(Math.round(e.nativeEvent.contentOffset.x / (ancho + 10)))}
        renderItem={({ item: o }) => {
          const a = acentoDe(t, o.acento);
          // El banner del portal ya trae su diseño: proporción 2.4 : 1, como se subió.
          return (
            <Pressable onPress={() => { if (!o.destino) return; Haptics.selectionAsync().catch(() => {}); router.push(o.destino); }}
              accessibilityRole="button" accessibilityLabel={`Oferta: ${o.titulo}`}
              style={({ pressed }) => ({ width: ancho, height: Math.round(ancho / 2.4), borderRadius: 24, overflow: 'hidden', transform: [{ scale: pressed ? 0.98 : 1 }] })}>
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
            </Pressable>
          );
        }}
      />
      {ofertas.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {ofertas.map((o, i) => (
            <View key={o.id} style={{ width: i === pagina ? 18 : 6, height: 6, borderRadius: 3,
              backgroundColor: i === pagina ? colorSistema.texto2 : colorSistema.texto3, opacity: i === pagina ? 1 : 0.4 }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
