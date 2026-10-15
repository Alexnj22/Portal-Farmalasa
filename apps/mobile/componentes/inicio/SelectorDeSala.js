// La sala que mira un widget del Inicio — el `LiquidSelect` compacto que el
// tablero del portal pone en el encabezado de «Meta del mes» o «Cortes de
// caja» cuando el alcance del widget es TODAS. Con alcance de sala NO se
// ofrece (la base rechaza otra sala y prometería un alcance que no existe).
//
// Fichas que se desplazan de lado, dentro del widget. `todas` agrega la ficha
// «Todas» (valor '') al principio.
import { Pressable, ScrollView, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colorSistema } from '../Formulario';
import { MARCA } from './marca';

export default function SelectorDeSala({ salas, activa, onCambiar, todas = false }) {
  const opciones = [...(todas ? [{ id: '', label: 'Todas' }] : []), ...salas];
  if (opciones.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
      {opciones.map((o) => {
        const esta = String(o.id) === String(activa ?? '');
        return (
          <Pressable key={o.id} accessibilityRole="button" accessibilityState={{ selected: esta }}
            onPress={() => { if (!esta) { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); } }}
            hitSlop={5} style={({ pressed }) => ({ minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: esta ? `${MARCA.azul}55` : 'rgba(127,127,127,0.16)', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <Text style={{ color: esta ? colorSistema.texto : colorSistema.texto2, fontSize: 13, fontWeight: esta ? '700' : '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Las salas de venta en el orden de la red, con su nombre del padrón. */
export function salasDeVenta(sucursales, ids) {
  return ids.map((id) => (sucursales || []).find((b) => String(b.id) === String(id)))
    .filter(Boolean).map((b) => ({ id: String(b.id), label: b.name }));
}
