// La frase del día (2026-11-03): una tarjeta con el degradado de su canasta,
// la comilla grande de fondo y la frase en blanco. Dos tamaños: `grande` en
// Bienestar (con la fecha y «Compartir») y el compacto del Inicio, que lleva a
// Bienestar. Los colores salen de los acentos del tema (tokens del portal).
//
// 2026-11-04 («siento que las cards tienen muchos colores… unifica pero que no
// pierdan la identidad»): el compacto del Inicio deja el degradado y va en el
// mismo vidrio que las demás tarjetas, con el recuadro de la marca y la comilla
// grande de fondo en magenta suave — la comilla es lo que la hace reconocible.
// El degradado se queda en Bienestar (`grande`), donde la frase es la portada.
//
// 2026-11-10: «Compartir» manda una IMAGEN con la marca (FraseImagen.js), y
// «Leído» se despide con una animación: el botón se vuelve una palomita verde
// que rebota, salta una ráfaga de chispas de colores, la tarjeta se inclina y
// se va, y el hueco se cierra solo. Con «reducir movimiento», sólo se desvanece.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import Presionable from './Presionable';
import { Tocable, useSinMovimiento } from './animacion';
import { TarjetaFrase, compartirFraseComoImagen } from './FraseImagen';
import { RADIO, Tarjeta } from './ui';
import { colorSistema } from './sistema';
import { suave, useTema } from '../tema/tema';
import { CATEGORIAS, marcarFraseLeida, useFraseDelDia, useFraseLeida } from '../lib/fraseDelDia';
import { navegar } from '../lib/navegar';
import { OndasFrase } from './IlustracionesInicio';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// La fecha del día DE LA FRASE (antes de las 8:00 todavía es la de ayer), a
// mano y no con Intl: el motor del teléfono no siempre trae los nombres en español.
function fechaDeFrase(dia) {
  // Mediodía de ese día en El Salvador, leído en UTC.
  const d = new Date(dia * 86_400_000 + 14 * 3_600_000 + 4 * 3_600_000);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

function colores(t, categoria) {
  const a = t.acentos;
  if (categoria === 'salud') return [a.azul.fuerte, a.verde.fuerte];
  if (categoria === 'calma') return [a.azul.fuerte, a.violeta.fuerte];
  return [a.violeta.fuerte, t.color.magenta];
}

export default function FraseDelDia({ grande = false }) {
  const t = useTema();
  const frase = useFraseDelDia();
  const leida = useFraseLeida();
  const cat = CATEGORIAS[frase.categoria];
  const imagen = useRef(null);
  const [compartiendo, setCompartiendo] = useState(false);
  const fecha = fechaDeFrase(frase.dia).replace(/^./, (c) => c.toUpperCase());
  const compartir = async () => {
    if (compartiendo) return;
    Haptics.selectionAsync().catch(() => {});
    setCompartiendo(true);
    await compartirFraseComoImagen(imagen, frase.texto);
    setCompartiendo(false);
  };

  if (!grande) {
    // Marcada como leída: fuera del Inicio hasta la frase siguiente.
    if (leida === frase.dia) return null;
    return <FraseInicio key={frase.dia} frase={frase} cat={cat} t={t} />;
  }

  return (
    <View>
      {/* La tarjeta que se fotografía, escondida fuera de la pantalla. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: -10000, top: 0 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <TarjetaFrase ref={imagen} frase={frase.texto} categoria={cat.nombre} fecha={fecha} colores={colores(t, frase.categoria)} />
      </View>
      <LinearGradient colors={colores(t, frase.categoria)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: RADIO.tarjeta, padding: 22, gap: 14, overflow: 'hidden', minHeight: 200 }}>
        {/* La comilla de fondo y un brillo: el adorno, no se lee. */}
        <Text importantForAccessibility="no" accessibilityElementsHidden
          style={{ position: 'absolute', right: 10, top: -36, fontSize: 200, fontWeight: '900', color: 'rgba(255,255,255,0.13)' }}>“</Text>
        <View pointerEvents="none" style={{ position: 'absolute', left: -60, bottom: -80, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.08)' }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Icono sf={cat.sf} respaldo="" tam={11} color="#FFFFFF" />
            <Text maxFontSizeMultiplier={1.2} style={{ flexShrink: 1, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#FFFFFF' }}>
              FRASE DEL DÍA · {cat.nombre.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.3, color: '#FFFFFF' }}>
          {frase.texto}
        </Text>

        {/* Con letra grande la fecha se encoge y, si hace falta, el botón baja
            a la línea siguiente. Nunca se sale de la tarjeta. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 'auto' }}>
          <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>
            {fecha}
          </Text>
          <Presionable onPress={compartir} disabled={compartiendo} accessibilityRole="button" accessibilityLabel="Compartir la frase como imagen" hitSlop={8}
            style={({ pressed }) => ({ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.22)', opacity: compartiendo ? 0.6 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Icono sf="square.and.arrow.up" respaldo="↗" tam={14} color="#FFFFFF" />
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFFFFF' }}>{compartiendo ? 'Preparando…' : 'Compartir'}</Text>
          </Presionable>
        </View>
      </LinearGradient>
    </View>
  );
}

// ── «Leído» ─────────────────────────────────────────────────────────────────
const CHISPAS = 22;

// Una chispa de la ráfaga: sale disparada desde el botón, se frena, cae un
// poco girando y se apaga. Unas son puntos, otras tiras y otras estrellitas.
function Chispa({ i, colores }) {
  const p = useSharedValue(0);
  // En abanico hacia arriba: el botón está abajo a la derecha de la tarjeta.
  const ang = -Math.PI / 2 + ((i / CHISPAS) * 2 - 1) * Math.PI * 0.62 + (i % 3) * 0.07;
  const dist = 60 + ((i * 37) % 70);
  const forma = i % 4;
  const color = colores[i % colores.length];
  useEffect(() => {
    p.value = withDelay((i * 13) % 90, withTiming(1, { duration: 1050, easing: Easing.out(Easing.cubic) }));
  }, [p, i]);
  const estilo = useAnimatedStyle(() => {
    const v = p.value;
    return {
      opacity: v < 0.7 ? 1 : (1 - v) / 0.3,
      transform: [
        { translateX: Math.cos(ang) * dist * v },
        { translateY: Math.sin(ang) * dist * v + 40 * v * v },
        { rotate: `${v * (i % 2 ? 420 : -420)}deg` },
        { scale: v < 0.15 ? v / 0.15 : 1 - (v - 0.15) * 0.5 },
      ],
    };
  });
  if (forma === 3) {
    return (
      <Animated.View style={[{ position: 'absolute' }, estilo]}>
        <Icono sf="sparkle" respaldo="✦" tam={13} color={color} />
      </Animated.View>
    );
  }
  const lado = forma === 0 ? 8 : 6;
  return <Animated.View style={[{ position: 'absolute', width: forma === 1 ? 11 : lado, height: lado, borderRadius: forma === 1 ? 2 : lado / 2, backgroundColor: color }, estilo]} />;
}

function FraseInicio({ frase, cat, t }) {
  const quieta = useSinMovimiento();
  const [estado, setEstado] = useState('quieta'); // quieta → celebra → se va
  const alto = useSharedValue(0);
  const check = useSharedValue(1); // la escala de la palomita (rebota al tocar)
  const salida = useSharedValue(0); // la tarjeta se inclina y se va
  const cierre = useSharedValue(0); // el hueco se cierra
  const verde = t.acentos?.verde?.fuerte ?? '#3FA34D';
  const colores = [t.color.magenta, verde, t.acentos?.violeta?.fuerte ?? '#7A4FD8', '#FFB020', t.acentos?.azul?.fuerte ?? '#3E7BFA'];

  const terminar = () => marcarFraseLeida(frase.dia);
  const leer = () => {
    if (estado !== 'quieta') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (quieta) {
      salida.value = withTiming(1, { duration: 250 });
      cierre.value = withTiming(1, { duration: 250 }, (ok) => { if (ok) runOnJS(terminar)(); });
      setEstado('se va');
      return;
    }
    setEstado('celebra');
    check.value = 0;
    check.value = withSequence(withSpring(1.35, { damping: 6, stiffness: 260 }), withSpring(1, { damping: 10, stiffness: 200 }));
    // Deja ver la palomita y las chispas; después se va.
    salida.value = withDelay(720, withTiming(1, { duration: 420, easing: Easing.in(Easing.cubic) }));
    cierre.value = withDelay(980, withTiming(1, { duration: 380, easing: Easing.inOut(Easing.cubic) }, (ok) => { if (ok) runOnJS(terminar)(); }));
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 760);
  };

  const estiloCaja = useAnimatedStyle(() => (cierre.value > 0 && alto.value > 0
    ? { height: alto.value * (1 - cierre.value), overflow: 'hidden' }
    : {}));
  const estiloTarjeta = useAnimatedStyle(() => ({
    opacity: 1 - salida.value,
    transform: [
      { translateX: salida.value * 70 },
      { translateY: -salida.value * 10 },
      { rotate: `${salida.value * 4}deg` },
      { scale: 1 - salida.value * 0.1 + (check.value > 1 ? (check.value - 1) * 0.04 : 0) },
    ],
  }));
  const estiloCheck = useAnimatedStyle(() => ({ transform: [{ scale: Math.max(0.01, check.value) }] }));
  const celebra = estado !== 'quieta';

  return (
    <Animated.View style={estiloCaja}>
      <Animated.View style={estiloTarjeta} onLayout={(e) => { if (cierre.value === 0) alto.value = e.nativeEvent.layout.height; }}>
        <Tocable etiqueta={`Frase del día: ${frase.texto}. Abre Bienestar`} alTocar={() => navegar('/bienestar')}>
          <Tarjeta estilo={{ gap: 12, overflow: 'visible', paddingVertical: 20 }}>
            <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, left: 0, overflow: 'hidden', borderRadius: RADIO.tarjeta }}>
              <View style={{ position: 'absolute', right: 0, top: 0 }}><OndasFrase tam={170} /></View>
              <Text importantForAccessibility="no" accessibilityElementsHidden
                style={{ position: 'absolute', right: 22, top: -30, fontSize: 140, fontWeight: '900', color: suave(t.color.magenta, t.oscuro ? 0.34 : 0.2) }}>“</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 64 }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.26 : 0.11) }}>
                <Icono sf={cat.sf} respaldo="" tam={16} color={t.color.magentaTexto} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: t.color.magentaTexto }}>FRASE DEL DÍA</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>{cat.nombre}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {/* El filo de la cita: una raya de la marca, como en un libro. */}
              <View style={{ width: 3, borderRadius: 2, backgroundColor: suave(t.color.magenta, t.oscuro ? 0.6 : 0.45) }} />
              <Text maxFontSizeMultiplier={1.6}
                style={{ flex: 1, fontSize: 20, lineHeight: 27, fontWeight: '800', letterSpacing: -0.3, color: colorSistema.texto }}>
                {frase.texto}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flexShrink: 1, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.12) }}>
                <Icono sf="sparkles" respaldo="" tam={13} color={t.color.magentaTexto} />
                <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '800', color: t.color.magentaTexto }}>Tu momento de bienestar</Text>
                <Icono sf="chevron.right" respaldo="›" tam={11} color={t.color.magentaTexto} />
              </View>
              {/* «Leído»: la quita del Inicio hasta la de mañana. */}
              <Presionable onPress={leer} disabled={celebra} accessibilityRole="button" accessibilityLabel="Marcar la frase como leída" hitSlop={6}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 999,
                  backgroundColor: celebra ? suave(verde, t.oscuro ? 0.3 : 0.14) : 'transparent',
                  transform: [{ scale: pressed ? 0.94 : 1 }] })}>
                <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
                  {celebra && !quieta ? (
                    <View pointerEvents="none" style={{ position: 'absolute', left: 11, top: 11 }}>
                      {Array.from({ length: CHISPAS }, (_, i) => <Chispa key={i} i={i} colores={colores} />)}
                    </View>
                  ) : null}
                  <Animated.View style={estiloCheck}>
                    <Icono sf={celebra ? 'checkmark.circle.fill' : 'checkmark.circle'} respaldo="✓" tam={celebra ? 20 : 16}
                      color={celebra ? verde : colorSistema.texto2} />
                  </Animated.View>
                </View>
                <Text style={{ fontSize: 14, fontWeight: celebra ? '800' : '700', color: celebra ? verde : colorSistema.texto2 }}>
                  {celebra ? '¡Leído!' : 'Leído'}
                </Text>
              </Presionable>
            </View>
          </Tarjeta>
        </Tocable>
      </Animated.View>
    </Animated.View>
  );
}
