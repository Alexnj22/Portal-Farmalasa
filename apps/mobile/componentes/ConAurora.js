// Una pantalla con la aurora detrás. Hace falta en las pestañas: la barra de
// pestañas de iOS pone su propio fondo (negro) detrás de cada una y tapa la
// aurora de la raíz, así que cada pestaña trae la suya.
import { View } from 'react-native';
import Aurora from './Aurora';

export default function ConAurora({ children }) {
  return (
    <View style={{ flex: 1 }}>
      <Aurora />
      {children}
    </View>
  );
}
