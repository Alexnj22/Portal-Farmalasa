// Una superficie de VIDRIO: el Liquid Glass de iOS 26 cuando existe, el
// desenfoque del sistema en iOS anteriores, y en Android la tarjeta OPACA de
// Material 3 (Android no tiene vidrio: su lenguaje es la superficie tonal).
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LIVIANO } from '../lib/rendimiento';

const HAY_VIDRIO = Platform.OS === 'ios' && (() => { try { return isLiquidGlassAvailable(); } catch { return false; } })();

export default function Vidrio({ style, children, radio = 22, interactivo = false, tinte, elevacion = 0 }) {
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
  // En un iPhone viejo sin Liquid Glass (2026-10-13), el desenfoque en vivo de
  // cada tarjeta es lo que más cuesta al desplazarse: va el fondo translúcido
  // sólido de abajo, que sobre la aurora se lee como la misma pieza.
  if (Platform.OS === 'ios' && !LIVIANO) {
    return (
      <BlurView intensity={70} tint={oscuro ? 'systemThickMaterialDark' : 'systemThickMaterialLight'} style={[forma, style]}>
        {tinte ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tinte }} /> : null}
        {children}
      </BlurView>
    );
  }
  // Android (2026-10-13): la tarjeta de Material 3, OPACA — sin vidrio, sin
  // translúcido que lo imite y sin borde: la superficie tonal (más clara que
  // el fondo en modo claro, más alta en oscuro) es la que separa. Esquinas de
  // 16 como mucho, el «large» de Material. `elevacion` sólo para lo que FLOTA
  // encima del contenido (el aviso con la app abierta); con el fondo opaco la
  // sombra ya no se transparenta como antes (2026-10-08).
  if (Platform.OS === 'android') {
    const r = Math.min(radio, 16);
    return (
      <View style={[{ borderRadius: r, overflow: 'hidden', backgroundColor: oscuro ? '#211F26' : '#FFFFFF' },
        elevacion ? { elevation: elevacion } : null, style]}>
        {tinte ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tinte }]} /> : null}
        {children}
      </View>
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
      {/* El tinte de la marca, sólo en el iPhone liviano (la web sigue sin él). */}
      {tinte && Platform.OS === 'ios' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tinte }]} /> : null}
      {children}
    </View>
  );
}
