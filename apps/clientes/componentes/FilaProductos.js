// Una fila horizontal de productos para la Tienda (2026-10-07): «Mayor ahorro
// con tu tarjeta», «Vistos recientemente». Tarjetas más grandes que las de la
// cuadrícula, con el porcentaje de ahorro bien visible.
import { FlatList, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import FotoProducto from './FotoProducto';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { navegar } from '../lib/navegar';
import { dolares } from '../lib/formato';
import { nombreProducto } from '../lib/catalogo';
import { useTema } from '../tema/tema';

export default function FilaProductos({ titulo, sf, productos, accion }) {
  const t = useTema();
  if (!productos?.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 }}>
        <Icono sf={sf} respaldo="" tam={14} color={t.color.magentaTexto} />
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{titulo}</Text>
        {accion ? (
          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); accion.alTocar(); }} hitSlop={10} accessibilityRole="button"
            style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto2 }}>{accion.texto}</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList horizontal data={productos} keyExtractor={(p) => String(p.id)} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}
        renderItem={({ item: p }) => {
          const ahorro = p.precio_vip != null && p.precio ? Math.round(((p.precio - p.precio_vip) / p.precio) * 100) : 0;
          return (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar(`/producto/${p.id}`); }}
              accessibilityRole="button" accessibilityLabel={nombreProducto(p.nombre)}
              style={({ pressed }) => ({ width: 150, borderRadius: 20, padding: 8, gap: 6,
                backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
              <View>
                <FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={110} radio={14} />
                {ahorro >= 1 ? (
                  <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: t.color.verde, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#1A2600', fontSize: 12, fontWeight: '900' }}>−{ahorro}%</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={2} style={{ fontSize: 13, fontWeight: '700', lineHeight: 17, color: colorSistema.texto, minHeight: 34 }}>{nombreProducto(p.nombre)}</Text>
              {p.precio != null ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: colorSistema.texto }}>{dolares(p.precio_vip ?? p.precio)}</Text>
                  {p.precio_vip != null ? <Text style={{ fontSize: 11, color: colorSistema.texto3, textDecorationLine: 'line-through' }}>{dolares(p.precio)}</Text> : null}
                </View>
              ) : null}
            </Pressable>
          );
        }} />
    </View>
  );
}
