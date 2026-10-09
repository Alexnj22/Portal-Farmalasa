// Android: el botón principal, dibujado con piezas de React Native en el color
// de la marca (2026-10-09).
//
// Hubo dos versiones antes, y las dos se veían mal en Android:
//  1. el botón Material de @expo/ui con `style={{ width: '100%' }}` CERRABA la
//     app al abrir Bienvenida (en Compose `width` sólo acepta números);
//  2. con `fillMaxWidth` ya abría, pero Material arma su paleta a partir del
//     color semilla y en modo oscuro dejaba el magenta en ROSA PASTEL con texto
//     apagado. En iPhone el principal es magenta sólido con texto blanco.
// Acá se pinta exactamente eso: lleno = magenta con blanco; contorno = borde y
// texto en el color; texto = sólo el color. La web sigue con `BotonNativo.js`.
import { Pressable, Text, useColorScheme } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTema } from '../tema/tema';

export default function BotonNativo({ etiqueta, alTocar, variante = 'filled', deshabilitado = false, color }) {
  const t = useTema();
  const oscuro = useColorScheme() === 'dark';
  const base = color ?? t.color.magenta;
  const lleno = variante === 'filled';
  const texto = lleno ? '#FFFFFF' : variante === 'outlined' ? (oscuro ? '#FFFFFF' : base) : base;
  return (
    <Pressable disabled={deshabilitado} accessibilityRole="button" accessibilityState={{ disabled: deshabilitado }}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar?.(); }}
      style={({ pressed }) => ({
        width: '100%', minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
        backgroundColor: lleno ? base : 'transparent',
        borderWidth: variante === 'outlined' ? 1.5 : 0,
        borderColor: oscuro ? 'rgba(255,255,255,0.45)' : base,
        opacity: deshabilitado ? 0.45 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      <Text style={{ color: texto, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{etiqueta}</Text>
    </Pressable>
  );
}
