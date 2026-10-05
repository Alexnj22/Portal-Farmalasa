// Fuera de iPhone (Android y la vista previa web): el control segmentado
// hecho con piezas de React Native. En iPhone, `Segmentos.ios.js` usa el del
// sistema.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { suave, useTema } from '../tema/tema';

/** Dos o tres opciones excluyentes, como el control segmentado del sistema. */
export default function Segmentos({ opciones, valor, alCambiar }) {
  const t = useTema();
  return (
    <View style={{
      flexDirection: 'row', padding: 4, gap: 4, marginHorizontal: 16, borderRadius: t.radio.control + 4,
      backgroundColor: suave(t.color.texto3, t.oscuro ? 0.25 : 0.12),
    }}>
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <Pressable
            key={o.valor}
            accessibilityRole="tab"
            accessibilityState={{ selected: activo }}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); alCambiar(o.valor); }}
            style={({ pressed }) => ({
              flex: 1, minHeight: t.tam.toque - 4, borderRadius: t.radio.control,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: activo ? t.color.tarjeta : 'transparent',
              shadowColor: '#000', shadowOpacity: activo ? 0.08 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: activo ? '700' : '500', color: activo ? t.color.texto : t.color.texto2 }}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
