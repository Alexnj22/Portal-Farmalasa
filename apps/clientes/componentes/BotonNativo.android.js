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
//
// Material 3 de verdad (2026-10-13): la ONDA del sistema al tocar en vez de
// encogerse y atenuarse (lenguaje de iOS), la forma de píldora completa, el
// contorno de 1 dp en el color «outline» y el rótulo en Label Large (medio,
// sin negrita). Alto de 52: pasa los 48 dp del dedo.
import { Pressable, Text, useColorScheme } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

export default function BotonNativo({ etiqueta, alTocar, variante = 'filled', deshabilitado = false, color }) {
  const t = useTema();
  const oscuro = useColorScheme() === 'dark';
  const base = color ?? t.color.magenta;
  const lleno = variante === 'filled';
  // En modo oscuro el texto de un botón sin relleno va en la versión clara de
  // la marca: el magenta sólido sobre la superficie oscura no llega al 4.5:1.
  const texto = lleno ? '#FFFFFF' : (oscuro && !color ? t.color.magentaTexto : base);
  return (
    <Pressable disabled={deshabilitado} accessibilityRole="button" accessibilityState={{ disabled: deshabilitado }}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar?.(); }}
      android_ripple={{ color: lleno ? 'rgba(255,255,255,0.28)' : 'rgba(127,127,127,0.22)', foreground: true }}
      style={{
        width: '100%', minHeight: 52, borderRadius: 26, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
        backgroundColor: lleno ? base : 'transparent',
        borderWidth: variante === 'outlined' ? 1 : 0,
        borderColor: colorSistema.contorno,
        opacity: deshabilitado ? 0.38 : 1,
      }}>
      <Text style={{ color: texto, fontSize: 16, fontWeight: '500', letterSpacing: 0.1 }} numberOfLines={1}>{etiqueta}</Text>
    </Pressable>
  );
}
