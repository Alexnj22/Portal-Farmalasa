// Un ícono del SISTEMA: SF Symbols en iPhone (los mismos de la barra de abajo),
// y un respaldo de texto en Android y web. Así la campana, la cartera o el
// carrito se ven como el resto de iOS y no como un emoji.
import { Platform, Text } from 'react-native';

let SymbolView = null;
if (Platform.OS === 'ios') {
  try { ({ SymbolView } = require('expo-symbols')); } catch { SymbolView = null; }
}

export default function Icono({ sf, respaldo = '•', tam = 22, color }) {
  if (SymbolView) {
    return <SymbolView name={sf} size={tam} tintColor={color} type="hierarchical" weight="medium" />;
  }
  return <Text style={{ fontSize: tam * 0.9, color }}>{respaldo}</Text>;
}
