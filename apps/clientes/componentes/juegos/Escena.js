// La escena de los juegos de Bienestar (2026-11-03, «que se vean modernos,
// visuales, bonitos»). Cada juego vive sobre un degradado propio de pantalla
// completa —bajo la barra de arriba, que en estas pantallas es transparente—
// con unas luces que flotan muy lento. Sobre el degradado todo es blanco y de
// vidrio, igual en tema claro y oscuro: es un lugar aparte, como una escena.
//
// Las luces son Skia en el hilo de la interfaz, a 30 cuadros: suben despacio y
// no le cuestan nada a JavaScript. Con «reducir movimiento» o en un teléfono
// liviano quedan quietas.
import { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Canvas, Circle, Group, RadialGradient, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSinMovimiento, Tocable } from '../animacion';
import Icono from '../Icono';
import { useAjustesSensaciones, tacto } from '../../lib/sensaciones';

export const BLANCO = '#FFFFFF';
export const BLANCO_2 = 'rgba(255,255,255,0.82)';
export const BLANCO_3 = 'rgba(255,255,255,0.62)';
export const VIDRIO = 'rgba(255,255,255,0.14)';
export const VIDRIO_BORDE = 'rgba(255,255,255,0.24)';

// Los degradados de cada juego (oscuros a propósito: el blanco se lee encima).
export const ESCENAS = {
  respira: ['#0B1E4A', '#27307A', '#4B2C86'],
  burbujas: ['#2A0F45', '#5A1A6E', '#8A1E6F'],
  memoria: ['#062B3A', '#0E4D5C', '#1D6B5E'],
  anclaje: ['#3A1206', '#7A2E14', '#8A1E55'],
  torre: ['#0A1240', '#26308A', '#7A3B9A'],
};

function Luz({ i, ancho, alto, reloj }) {
  // Cada luz tiene su carril: arranca abajo, sube y vuelve a empezar.
  const x0 = ((i * 97) % 100) / 100;
  const vel = 0.012 + ((i * 31) % 10) / 900;
  const r = 30 + ((i * 53) % 60);
  const cx = useDerivedValue(() => x0 * ancho + Math.sin(reloj.value * 0.3 + i) * 24);
  const cy = useDerivedValue(() => alto + r - (((reloj.value * vel + i / 9) % 1) * (alto + 2 * r)));
  const centro = useDerivedValue(() => vec(cx.value, cy.value));
  return (
    <Circle cx={cx} cy={cy} r={r}>
      <RadialGradient c={centro} r={r} colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']} />
    </Circle>
  );
}

function Luces({ cuantas = 9 }) {
  const { width, height } = useWindowDimensions();
  const quieta = useSinMovimiento();
  const reloj = useSharedValue(0);
  const acum = useSharedValue(0);
  useFrameCallback((f) => {
    acum.value += Math.min(0.1, (f.timeSincePreviousFrame ?? 16) / 1000);
    if (acum.value >= 0.033) { reloj.value += acum.value; acum.value = 0; }
  }, !quieta);
  const lista = useMemo(() => Array.from({ length: cuantas }, (_, i) => i), [cuantas]);
  return (
    <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Group>
        {lista.map((i) => <Luz key={i} i={i} ancho={width} alto={height} reloj={reloj} />)}
      </Group>
    </Canvas>
  );
}

/**
 * La pantalla de un juego. `fijo`: sin desplazamiento (el tablero de burbujas
 * o la torre, que usan el dedo para jugar y no pueden pelearse con el scroll).
 */
export function Escena({ colores, children, fijo = false, luces = true, estilo }) {
  const ins = useSafeAreaInsets();
  const barra = useHeaderHeight();
  const relleno = { paddingTop: barra + 8, paddingBottom: ins.bottom + 20, paddingHorizontal: 16, gap: 16 };
  return (
    <View style={{ flex: 1, backgroundColor: colores[0] }}>
      <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {luces ? <Luces /> : null}
      {fijo ? (
        <View style={[{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }, relleno, estilo]}>{children}</View>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}
          contentContainerStyle={[{ width: '100%', maxWidth: 560, alignSelf: 'center' }, relleno, estilo]}>
          {children}
        </ScrollView>
      )}
    </View>
  );
}

/** Una píldora de vidrio con un dato: «12 movimientos», «0:42». */
export function Marcador({ sf, texto, etiqueta }) {
  return (
    <View accessibilityLabel={etiqueta ?? texto} style={estilos.pildora}>
      {sf ? <Icono sf={sf} respaldo="" tam={15} color={BLANCO_2} /> : null}
      <Text style={estilos.pildoraTexto}>{texto}</Text>
    </View>
  );
}

function BotonRedondo({ sf, etiqueta, activo, alTocar }) {
  return (
    <Tocable etiqueta={etiqueta} alTocar={() => { alTocar(); tacto.roce(); }}>
      <View accessibilityState={{ checked: activo }}
        style={[estilos.redondo, !activo && { backgroundColor: 'rgba(0,0,0,0.18)', borderColor: 'rgba(255,255,255,0.12)' }]}>
        <Icono sf={sf} respaldo="" tam={18} color={activo ? BLANCO : BLANCO_3} />
      </View>
    </Tocable>
  );
}

/** Sonido y vibración: dos botones arriba de cada juego, guardados en el teléfono. */
export function ControlesSensaciones({ izquierda }) {
  const s = useAjustesSensaciones();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{izquierda}</View>
      <BotonRedondo sf={s.sonido ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} activo={s.sonido}
        etiqueta={s.sonido ? 'Sonido encendido. Toca para apagarlo' : 'Sonido apagado. Toca para encenderlo'} alTocar={s.alternarSonido} />
      <BotonRedondo sf={s.vibra ? 'iphone.radiowaves.left.and.right' : 'iphone.slash'} activo={s.vibra}
        etiqueta={s.vibra ? 'Vibración encendida. Toca para apagarla' : 'Vibración apagada. Toca para encenderla'} alTocar={s.alternarVibra} />
    </View>
  );
}

/** El botón grande del juego: blanco sobre la escena, o de vidrio si es secundario. */
export function BotonJuego({ children, alTocar, sf, secundario = false, color = '#1B1B2F' }) {
  return (
    <Tocable etiqueta={String(children)} alTocar={() => { tacto.roce(); alTocar(); }}>
      <View style={[estilos.boton, secundario && { backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE }]}>
        {sf ? <Icono sf={sf} respaldo="" tam={18} color={secundario ? BLANCO : color} /> : null}
        <Text style={{ fontSize: 17, fontWeight: '800', color: secundario ? BLANCO : color }}>{children}</Text>
      </View>
    </Tocable>
  );
}

/** Opciones de vidrio (técnica, minutos, dificultad). */
export function OpcionesJuego({ opciones, valor, alCambiar }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }} accessibilityRole="radiogroup">
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <Tocable key={String(o.valor)} etiqueta={o.texto} alTocar={() => { if (!activo) { tacto.roce(); alCambiar(o.valor); } }}>
            <View accessibilityRole="radio" accessibilityState={{ selected: activo }}
              style={[estilos.opcion, activo && { backgroundColor: BLANCO, borderColor: BLANCO }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: activo ? '#1B1B2F' : BLANCO }}>{o.texto}</Text>
              {o.detalle ? <Text style={{ fontSize: 11, fontWeight: '600', color: activo ? 'rgba(27,27,47,0.6)' : BLANCO_3 }}>{o.detalle}</Text> : null}
            </View>
          </Tocable>
        );
      })}
    </View>
  );
}

/** Un panel de vidrio para textos de ayuda. */
export function PanelVidrio({ children, estilo }) {
  return <View style={[estilos.panel, estilo]}>{children}</View>;
}

export const textoAyuda = { fontSize: 14, lineHeight: 20, color: BLANCO_2 };

// Los juegos se abren desde la pila con la barra transparente y letras blancas.
export const BARRA_DE_JUEGO = {
  headerTransparent: true,
  headerTintColor: BLANCO,
  headerTitleStyle: { color: BLANCO },
  headerShadowVisible: false,
  headerStyle: { backgroundColor: 'transparent' },
  ...(Platform.OS === 'ios' ? { headerBlurEffect: undefined, headerLargeTitle: false } : {}),
};

const estilos = StyleSheet.create({
  pildora: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17,
    backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  pildoraTexto: { fontSize: 14, fontWeight: '700', color: BLANCO, fontVariant: ['tabular-nums'] },
  redondo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  boton: { minHeight: 54, borderRadius: 27, backgroundColor: BLANCO, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, paddingHorizontal: 22,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  opcion: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: VIDRIO, borderWidth: 1, borderColor: VIDRIO_BORDE },
  panel: { borderRadius: 22, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
});
