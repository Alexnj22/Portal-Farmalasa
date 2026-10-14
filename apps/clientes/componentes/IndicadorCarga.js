// El indicador de carga del sistema. En Android va el de Material 3
// Expressive (IndicadorCarga.android.js); acá, la ruedita de iOS.
import { ActivityIndicator } from 'react-native';

export default function IndicadorCarga({ color, tam = 'small' }) {
  return <ActivityIndicator color={color} size={tam === 'grande' ? 'large' : 'small'} />;
}
