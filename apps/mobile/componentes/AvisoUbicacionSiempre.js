// La ruta quedó midiendo sólo con la app abierta: la persona dio la ubicación
// «mientras se usa» y no «siempre» (o el sistema no dejó arrancar el fondo).
// Se dice corto y con el camino a Ajustes, que es el único lugar donde se
// cambia: iOS no vuelve a mostrar el diálogo.
import { Linking, Pressable, Text, View } from 'react-native';
import { Aviso } from './formulario/Piezas';
import { MARCA } from './inicio/marca';

export const TEXTO_UBICACION_SIEMPRE = 'Para que se vea dónde vas con la app cerrada, permite la ubicación «Siempre» en Ajustes.';

export default function AvisoUbicacionSiempre() {
  return (
    <View style={{ gap: 6 }}>
      <Aviso tono="cuidado" texto={TEXTO_UBICACION_SIEMPRE} />
      <Pressable accessibilityRole="button" onPress={() => { Linking.openSettings().catch(() => {}); }} hitSlop={8}
        style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Abrir Ajustes</Text>
      </Pressable>
    </View>
  );
}
