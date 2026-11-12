// iPhone: el ícono como una vista nativa SIMPLE (`SymbolView` de expo-symbols,
// un UIImageView con el SF Symbol), no como una capa SwiftUI (`Host` + `Icon`
// de @expo/ui). Dentro de una lista que se desplaza o se rearma, la capa
// SwiftUI no seguía al botón: el escudo del seguro aparecía sobre la fila de
// una sala y los círculos de WhatsApp/Llamar quedaban vacíos (captura del
// usuario, 2026-11-12, v2.1513.8). El tamaño fijo del gemelo genérico no
// alcanzaba porque el problema no era la medida sino la capa.
//
// expo-symbols ya viene en el binario (dependencia de expo-router): llega por aire.
// Mismas props que el genérico: `name` (lo que da `Icon.select`, en iOS el
// nombre del SF Symbol), `size`, `color`.
import { View } from 'react-native';
import { SymbolView } from 'expo-symbols';

export default function IconoFijo({ name, size = 20, color, style }) {
  const simbolo = typeof name === 'string' ? name : name?.ios;
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]} pointerEvents="none">
      {simbolo ? <SymbolView name={simbolo} size={size} tintColor={color} resizeMode="scaleAspectFit" style={{ width: size, height: size }} /> : null}
    </View>
  );
}
