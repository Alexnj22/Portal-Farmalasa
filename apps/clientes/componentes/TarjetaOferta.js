// Una oferta como tarjeta. `completa` = el detalle (texto, condiciones y todos
// los productos); si no, la vista previa de la lista.
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Tarjeta, Texto, Titulo } from './ui';
import { colorSistema } from './sistema';
import { dolares, fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

export function Pildora({ color, texto }) {
  const t = useTema();
  return (
    <View style={{ backgroundColor: suave(color, t.oscuro ? 0.3 : 0.16), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: color === t.color.verde ? t.color.verdeTexto : t.color.magentaTexto }}>{texto}</Text>
    </View>
  );
}

export function ImagenOferta({ oferta, alto }) {
  if (!oferta.imagen) return null;
  return (
    <Image source={{ uri: oferta.imagen }} resizeMode="cover"
      style={{ width: '100%', aspectRatio: alto ? undefined : 16 / 9, height: alto, opacity: oferta.disponible ? 1 : 0.45 }} />
  );
}

export function CuerpoOferta({ oferta: o, completa = false }) {
  const t = useTema();
  return (
    <View style={{ padding: 18, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {o.etiqueta ? <Pildora color={t.color.magenta} texto={o.etiqueta} /> : null}
        {o.exclusiva ? <Pildora color={t.color.verde} texto="Exclusiva para socios" /> : null}
      </View>
      <Titulo estilo={{ fontSize: completa ? 24 : 18, fontWeight: '700' }}>{o.titulo}</Titulo>
      {o.disponible ? (
        <>
          {o.descripcion ? <Texto numberOfLines={completa ? undefined : 2}>{o.descripcion}</Texto> : null}
          {o.productos?.length ? <Productos productos={o.productos} todos={completa} /> : null}
          {completa && o.condiciones ? <Texto nivel={2} estilo={{ fontSize: 14 }}>{o.condiciones}</Texto> : null}
        </>
      ) : (
        <Texto nivel={2}>Únete al programa de puntos para ver y usar esta oferta.</Texto>
      )}
      <Texto nivel={3} estilo={{ fontSize: 13 }}>
        Hasta el {fecha(o.fin)}{o.salas ? ` · Sólo en ${o.salas.join(', ')}` : ' · En todas las salas'}
      </Texto>
    </View>
  );
}

// Los productos de un descuento: el precio normal tachado y el que se paga.
function Productos({ productos, todos }) {
  const t = useTema();
  const [abiertos, setAbiertos] = useState(todos);
  const visibles = abiertos ? productos : productos.slice(0, 3);
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      {visibles.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 15, color: colorSistema.texto2 }} numberOfLines={2}>{p.nombre}</Text>
          {p.precio != null ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 12, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(p.precio)}</Text>
              <Text style={{ fontSize: 17, fontWeight: '800', color: t.color.magentaTexto, fontVariant: ['tabular-nums'] }}>{dolares(p.precio_descuento)}</Text>
            </View>
          ) : null}
        </View>
      ))}
      {!abiertos && productos.length > 3 ? (
        <Text onPress={() => setAbiertos(true)} style={{ color: t.color.magentaTexto, fontWeight: '600', paddingVertical: 6 }}>
          Y {productos.length - 3} más
        </Text>
      ) : null}
      {todos ? <Texto nivel={3} estilo={{ fontSize: 12 }}>Precio desde, por unidad. El descuento se aplica en caja.</Texto> : null}
    </View>
  );
}

export default function TarjetaOferta({ oferta }) {
  return (
    <Tarjeta estilo={{ padding: 0, gap: 0, overflow: 'hidden' }}>
      <ImagenOferta oferta={oferta} />
      <CuerpoOferta oferta={oferta} />
    </Tarjeta>
  );
}
