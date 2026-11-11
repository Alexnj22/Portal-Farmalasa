// Lo que se queda fijo arriba al desplazar (2026-11-11, usuario: «deja las
// pestañas siempre al top, fijas»): el selector de secciones de Inicio y de
// Notificaciones. Va FUERA del ScrollView, justo debajo de la barra.
//
// En iOS la barra es transparente (BARRA_NATIVA) y la pantalla empieza detrás
// de ella, así que se baja por la altura de la barra. Como el ScrollView ahora
// empieza debajo de esto, su `contentInsetAdjustmentBehavior="automatic"` ya
// no le suma el margen de arriba: sólo el de la barra de pestañas de abajo.
//
// Por qué no `stickyHeaderIndices`: el encabezado pegajoso de React Native se
// pega al borde del ScrollView, que en iOS queda DETRÁS de la barra
// transparente, y el selector se escondía bajo el logo.
import { Platform, View } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';

export default function FijoArriba({ children }) {
  const alto = useHeaderHeight();
  return (
    <View style={{ paddingTop: (Platform.OS === 'ios' ? alto : 0) + 8, paddingBottom: 8 }}>
      {children}
    </View>
  );
}
