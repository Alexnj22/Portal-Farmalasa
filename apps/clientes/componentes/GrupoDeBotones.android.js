// Android (2026-10-14): el grupo de botones CONECTADOS de Material 3
// Expressive, en vez de chips sueltos. Los botones van pegados (2 dp entre
// uno y otro), las esquinas de afuera del grupo son redondas y las de
// adentro chicas; el elegido se rellena con el tono de la marca, lleva su ✓ y
// sus esquinas se vuelven PÍLDORA con un resorte espacial — la forma también
// dice cuál está elegido. Al apretar, la pieza se hunde apenas.
//
// Con rótulos largos («Vencidas o canceladas») el grupo no cabe en el ancho:
// se desliza de lado, como cualquier fila de Material.
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { suave, useTema } from '../tema/tema';
import { M3, PRESION, SUELTA } from './movimiento';
import { ONDA } from './Presionable';

const ALTO = 40;
const AFUERA = ALTO / 2;
const ADENTRO = 8;

const PressableAnimado = Animated.createAnimatedComponent(Pressable);

function Boton({ texto, activo, primero, ultimo, alTocar }) {
  const t = useTema();
  const elegido = useSharedValue(activo ? 1 : 0);
  const hundido = useSharedValue(1);
  useEffect(() => { elegido.value = withSpring(activo ? 1 : 0, M3.espacialRapido); }, [activo, elegido]);
  const forma = useAnimatedStyle(() => {
    const dentro = ADENTRO + (AFUERA - ADENTRO) * elegido.value;
    return {
      borderTopLeftRadius: primero ? AFUERA : dentro,
      borderBottomLeftRadius: primero ? AFUERA : dentro,
      borderTopRightRadius: ultimo ? AFUERA : dentro,
      borderBottomRightRadius: ultimo ? AFUERA : dentro,
      transform: [{ scale: hundido.value }],
    };
  });
  return (
    <PressableAnimado accessibilityRole="button" accessibilityState={{ selected: activo }} android_ripple={ONDA}
      hitSlop={{ top: 4, bottom: 4 }}
      onPressIn={() => { hundido.value = withSpring(0.96, PRESION); }}
      onPressOut={() => { hundido.value = withSpring(1, SUELTA); }}
      onPress={() => { if (!activo) { Haptics.selectionAsync().catch(() => {}); alTocar(); } }}
      style={[{ minHeight: ALTO, paddingLeft: activo ? 12 : 16, paddingRight: 16, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: activo ? suave(t.color.magenta, t.oscuro ? 0.42 : 0.20) : colorSistema.superficieAlta }, forma]}>
      {activo ? <Icono sf="checkmark" respaldo="✓" tam={18} color={colorSistema.texto} /> : null}
      <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: activo ? '700' : '500', letterSpacing: 0.1, color: colorSistema.texto }}>{texto}</Text>
    </PressableAnimado>
  );
}

export default function GrupoDeBotones({ opciones, valor, alCambiar }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 2 }}>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 2 }}>
        {opciones.map(([k, texto], i) => (
          <Boton key={k} texto={texto} activo={valor === k} primero={i === 0} ultimo={i === opciones.length - 1} alTocar={() => alCambiar(k)} />
        ))}
      </View>
    </ScrollView>
  );
}
