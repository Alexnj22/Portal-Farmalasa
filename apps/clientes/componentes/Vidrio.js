// Una superficie de VIDRIO: el Liquid Glass de iOS 26 cuando existe, el
// desenfoque del sistema en iOS anteriores, y en Android una tarjeta Material
// translúcida con su elevación (Android no tiene vidrio: su lenguaje es la
// superficie tonal). Sobre la aurora las tres se leen como la misma pieza.
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

const HAY_VIDRIO = Platform.OS === 'ios' && (() => { try { return isLiquidGlassAvailable(); } catch { return false; } })();

export default function Vidrio({ style, children, radio = 22, interactivo = false, tinte }) {
  const oscuro = useColorScheme() === 'dark';
  const forma = { borderRadius: radio, overflow: 'hidden' };
  // Sin tinte propio, un velo del fondo del sistema: el Liquid Glass «regular»
  // es casi transparente y sobre la aurora el texto quedaba encima del color
  // (probado en TestFlight el 2026-10-06). Con el velo se sigue viendo vidrio,
  // pero el texto tiene fondo.
  const velo = oscuro ? 'rgba(18,16,24,0.55)' : 'rgba(255,255,255,0.62)';
  if (HAY_VIDRIO) {
    // El vidrio va DETRÁS, en su propia capa, sobre una base de color
    // (2026-10-08): el Liquid Glass a veces no se dibuja cuando la tarjeta
    // entra con una animación de opacidad (Entrada) o se monta fuera de
    // pantalla, y quedaba el texto suelto sin tarjeta — «unas tienen card y
    // otras no». Con la base, si el vidrio falla, la tarjeta igual se ve.
    const base = oscuro ? 'rgba(18,16,24,0.42)' : 'rgba(255,255,255,0.46)';
    return (
      <View style={[forma, { backgroundColor: base }, style]}>
        <GlassView glassEffectStyle="regular" isInteractive={interactivo} tintColor={tinte ?? velo}
          style={StyleSheet.absoluteFill} pointerEvents="none" />
        {children}
      </View>
    );
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={70} tint={oscuro ? 'systemThickMaterialDark' : 'systemThickMaterialLight'} style={[forma, style]}>
        {tinte ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tinte }} /> : null}
        {children}
      </BlurView>
    );
  }
  return (
    <View style={[forma, {
      backgroundColor: oscuro ? 'rgba(40,38,48,0.82)' : 'rgba(255,255,255,0.80)',
      // Sin `elevation` (2026-10-08): en Android la sombra se dibuja DETRÁS de
      // la tarjeta y se transparenta por el fondo al 80%, y quedaba un
      // rectángulo más claro adentro de cada tarjeta (visto en el emulador).
      // El borde fino hace de separación sobre la aurora.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: oscuro ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
    }, style]}>
      {children}
    </View>
  );
}
