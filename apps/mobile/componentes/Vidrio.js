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
  if (HAY_VIDRIO) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactivo} tintColor={tinte}
        style={[forma, style]}>
        {children}
      </GlassView>
    );
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={60} tint={oscuro ? 'systemMaterialDark' : 'systemMaterialLight'} style={[forma, style]}>
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
