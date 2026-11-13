// La marca de «esta fila está elegida» en una lista.
//   · iPhone: la palomita (✓) al final de la fila, como Ajustes de iOS; nada si
//     no está elegida.
//   · Android: el botón de opción de Material 3 (una sola elegida) o la casilla
//     (`multiple`), SIEMPRE visible — elegida o no — como en cualquier lista de
//     Android (2026-11-13, «TODO debe ser material nuevo en android»).
import { Platform, Text, View } from 'react-native';
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';

export default function MarcaDeEleccion({ elegida, multiple = false, color }) {
  if (Platform.OS !== 'android') {
    return elegida ? <Text style={{ color: color ?? MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null;
  }
  const acento = colorSistema.acento;
  if (multiple) {
    return (
      <View style={{ width: 20, height: 20, borderRadius: 3, borderWidth: elegida ? 0 : 2, borderColor: colorSistema.texto2,
        backgroundColor: elegida ? acento : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {elegida ? <Text style={{ color: colorSistema.fondo, fontSize: 14, fontWeight: '900', lineHeight: 16 }}>✓</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: elegida ? acento : colorSistema.texto2,
      alignItems: 'center', justifyContent: 'center' }}>
      {elegida ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: acento }} /> : null}
    </View>
  );
}
