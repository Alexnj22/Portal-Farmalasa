// Android (2026-10-13): sin aurora. El fondo es la SUPERFICIE de Material 3,
// sólida, clara u oscura según el sistema — como cualquier app de Android y
// como la app del personal (apps/mobile/componentes/Aurora.js).
//
// La aurora es lenguaje de iOS: el vidrio la necesita detrás. En Android no
// hay vidrio, y la aurora viva costaba dos veces: un lienzo de Skia con tres
// manchas desenfocadas redibujado cada cuadro, y pantallas TRANSPARENTES para
// que se viera — así que en cada transición se componían las dos pantallas
// encima de la aurora y se veía la de atrás a través de la de adelante
// («las transiciones no se ven bien», usuario 2026-10-13).
import { StyleSheet, useColorScheme, View } from 'react-native';
import { colorSistema } from './sistema';

export default function Aurora() {
  useColorScheme(); // `colorSistema` es un getter: esto lo repinta al cambiar de modo
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colorSistema.fondo }]} />;
}
