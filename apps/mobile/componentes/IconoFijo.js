// Un ícono del sistema con su lugar RESERVADO desde el primer dibujo
// (2026-11-12, usuario: «siempre se mueven los íconos al contraer y
// expandir»). `<Host matchContents>` mide el ícono DESPUÉS de dibujarlo: cada
// vez que la lista se rearma (contraer una sala, abrir un grupo) el ícono nacía
// en 0 × 0, se veía corrido y saltaba a su lugar; en iPhone, dentro de un
// botón, quedaba fuera de él. Con el tamaño fijo, nace donde va.
//
// Mismas props que `Icon` de `@expo/ui` (`name`, `size`, `color`…).
import { View } from 'react-native';
import { Host, Icon } from '@expo/ui';
import { SEMILLA } from '../tema/material';

export default function IconoFijo({ size = 20, style, ...props }) {
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]} pointerEvents="none">
      <Host seedColor={SEMILLA} style={{ width: size, height: size }}><Icon size={size} {...props} /></Host>
    </View>
  );
}
