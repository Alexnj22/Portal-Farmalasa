// El banner de promociones (2026-10-07): arriba del catálogo, las ofertas
// vigentes que se publican en el portal, en tarjetas grandes que se pasan con
// el dedo. No hay que cargar nada aparte: es la misma oferta que ya sale en
// «Ofertas» (y en las historias, si lleva una). Sin ofertas, no se muestra.
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
import { colorSistema } from './sistema';
import { acentoDe, useTema } from '../tema/tema';

export default function BannerPromos() {
  const t = useTema();
  const { width } = useWindowDimensions();
  const { datos, cargar } = useOfertas();
  const [pagina, setPagina] = useState(0);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const ofertas = (datos?.ofertas ?? []).filter((o) => o.disponible !== false).slice(0, 8);
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
          return (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/oferta/${o.id}`); }}
              accessibilityRole="button" accessibilityLabel={`Oferta: ${o.titulo}`}
              style={({ pressed }) => ({ width: ancho, height: 150, borderRadius: 24, overflow: 'hidden', transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              {o.imagen ? (
                <ImagenCache source={{ uri: o.imagen, cacheKey: o.imagen_clave ?? undefined }} cachePolicy="memory-disk"
                  contentFit="cover" transition={150} style={StyleSheet.absoluteFill} />
              ) : (
                <LinearGradient colors={[a.fuerte, '#2B0B3A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              )}
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
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' }}>Ver oferta ›</Text>
              </View>
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
