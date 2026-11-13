// Android: el indicador de carga de Material 3 Expressive (ContainedLoadingIndicator):
// la forma que se transforma mientras gira, en su contenedor tonal, con la
// paleta de la marca (tema/material.js).
import { View } from 'react-native';
import { ContainedLoadingIndicator, Host } from '@expo/ui/jetpack-compose';
import { SEMILLA } from '../../tema/material';

export default function Cargando() {
  return (
    <View style={{ marginTop: 32, alignItems: 'center' }}>
      <Host matchContents seedColor={SEMILLA}><ContainedLoadingIndicator /></Host>
    </View>
  );
}
