// Las piezas chicas de la bodega de Torogoz en la app: el color de la marca,
// la insignia con la variante del núcleo (`success`/`warning`/…), la ficha
// tocable de una lista y la confirmación nativa antes de escribir.
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';
import { colorDeVariante } from '../../colorDeVariante';

// COLORES_DISTRIBUIDORA.petroleo — el mismo del menú de Torogoz.
export const PETROLEO = '#0f6e7d';

/** Una insignia con la variante que nombra el núcleo. */
export function Chapa({ variante = 'neutral', texto }) {
  const c = colorDeVariante(variante);
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: typeof c === 'string' ? `${c}26` : 'rgba(127,127,127,0.16)' }}>
      <Text style={{ color: c, fontSize: 12, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
}

/** Una ficha de lista en vidrio; tocable si trae `onPress`, con menú si trae `onLongPress`. */
export function Ficha({ onPress, onLongPress, tinte, children }) {
  const tocable = !!(onPress || onLongPress);
  return (
    <Pressable disabled={!tocable} style={{ marginHorizontal: 16 }}
      onPress={onPress ? () => { Haptics.selectionAsync().catch(() => {}); onPress(); } : undefined}
      onLongPress={onLongPress ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onLongPress(); } : undefined}>
      {({ pressed }) => (
        <Vidrio radio={18} interactivo={tocable} tinte={tinte} style={{ transform: [{ scale: pressed ? 0.98 : 1 }] }}>
          <View style={{ padding: 14, gap: 6 }}>{children}</View>
        </Vidrio>
      )}
    </Pressable>
  );
}

/** El texto vacío de una lista. */
export function Vacio({ titulo, texto }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, gap: 4 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>{titulo}</Text>
      {texto ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>{texto}</Text> : null}
    </View>
  );
}

/** La confirmación del sistema antes de escribir. Resuelve `true` si se aceptó. */
export function confirmar(titulo, mensaje, boton, { destructivo = false } = {}) {
  return new Promise((resolve) => {
    Alert.alert(titulo, mensaje, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: boton, style: destructivo ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
