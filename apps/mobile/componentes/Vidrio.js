// Una superficie de VIDRIO: el Liquid Glass de iOS 26 cuando existe, el
// desenfoque del sistema en iOS anteriores, y en Android una tarjeta Material
// translúcida con su elevación (Android no tiene vidrio: su lenguaje es la
// superficie tonal). Sobre la aurora las tres se leen como la misma pieza.
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { usePreferenciaDeTema } from '../tema/preferencia';

const HAY_VIDRIO = Platform.OS === 'ios' && (() => { try { return isLiquidGlassAvailable(); } catch { return false; } })();

// El tinte (lo que marca la píldora o el día elegido) sólo lo pinta el Liquid
// Glass. Sin él se pone encima como capa de color: si no, en Android y en iOS
// viejo la píldora elegida quedaba blanca con el texto blanco encima (visto en
// el emulador, Horarios, 2026-10-12).
const Tinte = ({ color, radio }) => (color ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: radio }]} /> : null);

export default function Vidrio({ style, children, radio = 22, interactivo = false, tinte }) {
  const oscuro = useColorScheme() === 'dark';
  // Estilo «Sólido» (Yo › Apariencia, el tema Solid del portal): la superficie
  // opaca de las filas del sistema, sin vidrio ni desenfoque.
  const solido = usePreferenciaDeTema((s) => s.estilo === 'solido');
  const forma = { borderRadius: radio, overflow: 'hidden' };
  if (solido && Platform.OS === 'ios') {
    return (
      <View style={[forma, { backgroundColor: oscuro ? '#1C1C1E' : '#FFFFFF' }, style]}>
        <Tinte color={tinte} radio={radio} />
        {children}
      </View>
    );
  }
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
        <Tinte color={tinte} radio={radio} />
        {children}
      </BlurView>
    );
  }
  // Android: la tarjeta «filled» de Material 3 — superficie sólida, sin borde
  // ni translúcido imitando vidrio, esquinas de 16 como mucho. Sin
  // `overflow: hidden`: recortar a esquinas redondas obliga a pintar cada
  // tarjeta con máscara (caro en listas largas); lo que sí necesita recorte (un
  // mapa, una foto a sangre) lo pide su propio contenedor.
  const r = Math.min(radio, 16);
  return (
    <View style={[{ borderRadius: r, backgroundColor: oscuro ? '#211F26' : '#FFFFFF' }, style]}>
      <Tinte color={tinte} radio={r} />
      {children}
    </View>
  );
}
