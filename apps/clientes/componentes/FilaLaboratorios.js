// Los laboratorios en la Tienda Salud (2026-11-05, usuario: «¿y lo que
// hablamos de promociones? ¿laboratorios? en la tienda?»). Los 12 con más
// productos entre los más vendidos, que manda app_catalogo con la primera
// tanda. La foto se sube en el portal (Laboratorios); sin foto, su inicial en
// un círculo con el color de la marca. Tocarlo muestra sus productos.
import { ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInRight } from 'react-native-reanimated';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

export default function FilaLaboratorios({ labs, alElegir }) {
  const t = useTema();
  if (!labs?.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 }}>
        <Icono sf="building.2.fill" respaldo="" tam={14} color={t.color.magentaTexto} />
        <Text accessibilityRole="header" style={{ flex: 1, fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>Laboratorios</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
        {labs.map((l, i) => (
          <Animated.View key={l.id} entering={FadeInRight.delay(Math.min(i, 5) * 50).duration(260)}>
          <Presionable onPress={() => alElegir(l)} accessibilityRole="button" accessibilityLabel={`Productos de ${l.nombre}`}
            style={({ pressed }) => ({ width: 92, alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 18,
              backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <View style={{ width: 56, height: 56, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
              backgroundColor: l.foto ? '#FFFFFF' : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.05)') }}>
              {l.foto
                ? <Image source={{ uri: l.foto }} contentFit="contain" transition={160} style={{ width: 48, height: 48 }} accessible={false} />
                : <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 20, fontWeight: '900', color: t.color.magentaTexto }}>{l.nombre.slice(0, 1)}</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ fontSize: 12, fontWeight: '700', textAlign: 'center', color: colorSistema.texto }}>{l.nombre}</Text>
          </Presionable>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}
