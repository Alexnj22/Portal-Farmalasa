// Una oferta como pieza de vitrina. La foto ocupa la tarjeta entera, un velo
// del color de ACENTO de la oferta (`ofertas_clientes.acento`) sostiene el
// título en blanco, y la etiqueta («−20%», «2×1») va grande, en su color, como
// en un afiche. Sin foto, el fondo es un degradado del mismo acento.
//
// Movimiento, todo en el hilo de la interfaz (Reanimated):
//   · la foto entra con un zoom lento (de 1.12 a 1, «Ken Burns»);
//   · la etiqueta aparece con un rebote, un poco después;
//   · si quedan 3 días o menos, el aviso de «quedan N días» late.
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Vidrio from './Vidrio';
import { Texto, Titulo } from './ui';
import { colorSistema } from './sistema';
import { dolares, diasHasta, fecha } from '../lib/formato';
import { acentoDe, suave, useTema } from '../tema/tema';

export function Pildora({ color, texto, solida = false }) {
  const t = useTema();
  if (solida) {
    return (
      <View style={{ backgroundColor: color, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>{texto}</Text>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: suave(color, t.oscuro ? 0.3 : 0.16), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: color === t.color.verde ? t.color.verdeTexto : t.color.magentaTexto }}>{texto}</Text>
    </View>
  );
}

/** «Quedan 3 días» / «Último día». Late cuando el plazo es corto. */
export function Plazo({ fin, color }) {
  const d = diasHasta(fin);
  const pulso = useSharedValue(1);
  const corto = d != null && d <= 3;
  useEffect(() => {
    if (!corto) return;
    pulso.value = withRepeat(withSequence(withTiming(1.08, { duration: 600 }), withTiming(1, { duration: 600 })), -1);
  }, [corto, pulso]);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: pulso.value }] }));
  const texto = d == null ? '' : d <= 0 ? 'Último día' : d === 1 ? 'Queda 1 día' : d <= 14 ? `Quedan ${d} días` : `Hasta el ${fecha(fin)}`;
  return (
    <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, estilo]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: corto ? '#FF9F0A' : color }} />
      <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto2 }}>{texto}</Text>
    </Animated.View>
  );
}

/** La foto (o el degradado del acento) con la etiqueta y el título encima. */
export function PortadaOferta({ oferta: o, alto = 230, conTitulo = true }) {
  const t = useTema();
  const a = acentoDe(t, o.acento);
  const zoom = useSharedValue(1.12);
  const etiqueta = useSharedValue(0);
  useEffect(() => {
    zoom.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
    etiqueta.value = withDelay(250, withSpring(1, { damping: 11, stiffness: 160 }));
  }, [zoom, etiqueta]);
  const estiloFoto = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const estiloEtiqueta = useAnimatedStyle(() => ({ transform: [{ scale: etiqueta.value }, { rotate: `${(1 - etiqueta.value) * -8}deg` }] }));

  return (
    <View style={{ height: alto, overflow: 'hidden', backgroundColor: a.fuerte }}>
      {o.imagen ? (
        <Animated.View style={[StyleSheet.absoluteFill, estiloFoto]}>
          <Image source={{ uri: o.imagen }} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: o.disponible ? 1 : 0.5 }]} />
        </Animated.View>
      ) : (
        <LinearGradient colors={[a.fuerte, suave(a.fuerte, 0.55)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
          {/* Sin foto, la etiqueta enorme y tenue hace de ilustración. */}
          <Text style={{ position: 'absolute', right: -10, bottom: -30, fontSize: 150, fontWeight: '900', color: 'rgba(255,255,255,0.14)' }}>
            {o.etiqueta || '%'}
          </Text>
        </LinearGradient>
      )}
      {/* El velo: del acento a transparente, para que el título se lea siempre. */}
      <LinearGradient
        colors={['transparent', suave(a.fuerte, 0.35), suave('#000000', 0.72)]}
        locations={[0.25, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {o.etiqueta ? (
          <Animated.View style={[{
            backgroundColor: a.fuerte, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
            shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
          }, estiloEtiqueta]}>
            <Text style={{ fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5 }}>{o.etiqueta}</Text>
          </Animated.View>
        ) : <View />}
        {o.exclusiva ? (
          <Vidrio radio={999}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 6 }}>
              ★ Exclusiva socios
            </Text>
          </Vidrio>
        ) : null}
      </View>
      {conTitulo ? (
        <View style={{ position: 'absolute', left: 18, right: 18, bottom: 16, gap: 4 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8 }} numberOfLines={2}>
            {o.titulo}
          </Text>
          {o.disponible && o.descripcion ? (
            <Text style={{ fontSize: 15, color: 'rgba(255,255,255,0.88)' }} numberOfLines={2}>{o.descripcion}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** El cuerpo del detalle: texto completo, productos con precio y condiciones. */
export function CuerpoOferta({ oferta: o, completa = false }) {
  const t = useTema();
  const a = acentoDe(t, o.acento);
  return (
    <View style={{ padding: 18, gap: 10 }}>
      {completa ? <Titulo estilo={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}>{o.titulo}</Titulo> : null}
      {o.disponible ? (
        <>
          {completa && o.descripcion ? <Texto>{o.descripcion}</Texto> : null}
          {o.productos?.length ? <Productos productos={o.productos} todos={completa} color={a.texto} /> : null}
          {completa && o.condiciones ? <Texto nivel={2} estilo={{ fontSize: 14 }}>{o.condiciones}</Texto> : null}
        </>
      ) : (
        <Texto nivel={2}>Únete al programa de puntos para ver y usar esta oferta.</Texto>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Plazo fin={o.fin} color={a.fuerte} />
        <Text style={{ fontSize: 13, color: colorSistema.texto3 }} numberOfLines={1}>
          {o.salas ? `Sólo en ${o.salas.join(', ')}` : 'En todas las salas'}
        </Text>
      </View>
    </View>
  );
}

// Los productos de un descuento: el precio normal tachado y el que se paga.
function Productos({ productos, todos, color }) {
  const [abiertos, setAbiertos] = useState(todos);
  const visibles = abiertos ? productos : productos.slice(0, 3);
  return (
    <View style={{ gap: 8 }}>
      {visibles.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 15, color: colorSistema.texto2 }} numberOfLines={2}>{p.nombre}</Text>
          {p.precio != null ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 12, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(p.precio)}</Text>
              <Text style={{ fontSize: 17, fontWeight: '800', color, fontVariant: ['tabular-nums'] }}>{dolares(p.precio_descuento)}</Text>
            </View>
          ) : null}
        </View>
      ))}
      {!abiertos && productos.length > 3 ? (
        <Text onPress={() => setAbiertos(true)} style={{ color, fontWeight: '600', paddingVertical: 6 }}>Y {productos.length - 3} más</Text>
      ) : null}
      {todos ? <Texto nivel={3} estilo={{ fontSize: 12 }}>Precio desde, por unidad. El descuento se aplica en caja.</Texto> : null}
    </View>
  );
}

/** La tarjeta de la lista: portada a todo lo ancho + pie de vidrio. `destacada` = la primera, más alta. */
export default function TarjetaOferta({ oferta, destacada = false }) {
  return (
    <View style={{ borderRadius: 28, overflow: 'hidden' }}>
      <PortadaOferta oferta={oferta} alto={destacada ? 300 : 220} />
      <Vidrio radio={0}>
        <CuerpoOferta oferta={oferta} />
      </Vidrio>
    </View>
  );
}
