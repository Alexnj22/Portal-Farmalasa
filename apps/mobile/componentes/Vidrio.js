// Una superficie de VIDRIO: el Liquid Glass de iOS 26 cuando existe, el
// desenfoque del sistema en iOS anteriores, y en Android una tarjeta Material
// translúcida con su elevación (Android no tiene vidrio: su lenguaje es la
// superficie tonal). Sobre la aurora las tres se leen como la misma pieza.
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { usePreferenciaDeTema } from '../tema/preferencia';
import { usePaleta } from '../tema/material';
import { papel, relieve, RADIO } from '../tema/papel';

const HAY_VIDRIO = Platform.OS === 'ios' && (() => { try { return isLiquidGlassAvailable(); } catch { return false; } })();

// El tinte (lo que marca la píldora o el día elegido) sólo lo pinta el Liquid
// Glass. Sin él se pone encima como capa de color: si no, en Android y en iOS
// viejo la píldora elegida quedaba blanca con el texto blanco encima (visto en
// el emulador, Horarios, 2026-10-12).
// Papel (la línea Mostrador): los radios de la app se llevan a los
// concéntricos de la línea — tarjeta 28, pieza interior 22, renglón 16.
const radioPapel = (r) => (r >= 20 ? RADIO.tarjeta : r >= 16 ? RADIO.variasLineas : RADIO.renglon);

// El estilo que pasa quien llama se reparte: lo que acomoda a los hijos
// (dirección, separación, relleno) va a la vista de adentro, que es la que los
// contiene; el tamaño, los márgenes y la transformación, a la de afuera.
const DE_ADENTRO = /^(flexDirection|flexWrap|gap|rowGap|columnGap|alignItems|justifyContent|alignContent|padding.*)$/;
function repartir(style) {
  const plano = StyleSheet.flatten(style) || {};
  const fuera = {};
  const dentro = {};
  for (const [k, v] of Object.entries(plano)) (DE_ADENTRO.test(k) ? dentro : fuera)[k] = v;
  return { fuera, dentro };
}

// Sobre papel no hay vidrio que mezcle: un tinte fuerte de lo ELEGIDO (35 %
// o más, el que lleva texto blanco encima) se pinta sólido, como la marca
// sólida del portal; uno suave se queda como fondo teñido.
function tintePapel(tinte) {
  const m = typeof tinte === 'string' && tinte.match(/^(#[0-9a-f]{6})([0-9a-f]{2})$/i);
  return m && parseInt(m[2], 16) >= 0x59 ? m[1] : tinte;
}

const Tinte = ({ color, radio }) => (color ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: radio }]} /> : null);

export default function Vidrio({ style, children, radio = 22, interactivo = false, tinte }) {
  const oscuro = useColorScheme() === 'dark';
  // Estilo «Sólido» (Yo › Apariencia, el tema Solid del portal): la superficie
  // opaca de las filas del sistema, sin vidrio ni desenfoque.
  const solido = usePreferenciaDeTema((s) => s.estilo === 'solido');
  const paleta = usePaleta();
  const conPapel = usePreferenciaDeTema((s) => s.estilo === 'papel');
  const forma = { borderRadius: radio, overflow: 'hidden' };
  // Papel (el estilo de la app desde 2026-11-19, DISENO-MOSTRADOR §0): la
  // superficie de papel con RELIEVE — luz interior, contacto y ambiente — en
  // vez de vidrio. La sombra va en una vista de afuera sin recorte (con
  // `overflow: hidden` iOS no la pinta) y el contenido se recorta adentro.
  if ((conPapel || solido) && Platform.OS === 'ios') {
    const p = papel(oscuro);
    const r = radioPapel(radio);
    const { fuera, dentro } = repartir(style);
    return (
      <View style={[{ borderRadius: r, backgroundColor: p.superficie }, solido ? { borderWidth: StyleSheet.hairlineWidth, borderColor: p.linea } : { boxShadow: relieve(oscuro) }, fuera]}>
        <View style={[{ flexGrow: 1, borderRadius: r, overflow: 'hidden' }, dentro]}>
          <Tinte color={tintePapel(tinte)} radio={r} />
          {children}
        </View>
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
  // El color es la superficie tonal de la paleta del sistema (tema/material.js):
  // en claro la más alta sobre el fondo, en oscuro el contenedor tonal.
  const r = Math.min(radio, 16);
  const fondo = paleta ? (oscuro ? paleta.surfaceContainerHigh : paleta.surfaceContainerLowest) : (oscuro ? '#211F26' : '#FFFFFF');
  return (
    <View style={[{ borderRadius: r, backgroundColor: fondo }, style]}>
      <Tinte color={tinte} radio={r} />
      {children}
    </View>
  );
}
