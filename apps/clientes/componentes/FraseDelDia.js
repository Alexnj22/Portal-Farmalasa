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
import { LayoutAnimation, Share, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import Presionable from './Presionable';
import { Tocable } from './animacion';
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
  const compartir = () => {
    Haptics.selectionAsync().catch(() => {});
    Share.share({ message: `«${frase.texto}»\n\nFrase del día · Puntos Salud` }).catch(() => {});
  };

  const cuerpo = (
    <LinearGradient colors={colores(t, frase.categoria)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: RADIO.tarjeta, padding: grande ? 22 : 18, gap: grande ? 14 : 8, overflow: 'hidden', minHeight: grande ? 200 : 0 }}>
      {/* La comilla de fondo y un brillo: el adorno, no se lee. */}
      <Text importantForAccessibility="no" accessibilityElementsHidden
        style={{ position: 'absolute', right: 10, top: grande ? -36 : -44, fontSize: grande ? 200 : 170, fontWeight: '900', color: 'rgba(255,255,255,0.13)' }}>“</Text>
      <View pointerEvents="none" style={{ position: 'absolute', left: -60, bottom: -80, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.08)' }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Icono sf={cat.sf} respaldo="" tam={11} color="#FFFFFF" />
          <Text maxFontSizeMultiplier={1.2} style={{ flexShrink: 1, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#FFFFFF' }}>
            FRASE DEL DÍA · {cat.nombre.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text maxFontSizeMultiplier={1.4}
        style={{ fontSize: grande ? 26 : 19, lineHeight: grande ? 33 : 25, fontWeight: '800', letterSpacing: -0.3, color: '#FFFFFF' }}>
        {frase.texto}
      </Text>

      {grande ? (
        // Con letra grande (Android con el tamaño de fuente subido) la fecha y
        // «Compartir» no caben en una línea: la fecha se encoge y, si hace falta,
        // el botón baja a la siguiente. Nunca se sale de la tarjeta.
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 'auto' }}>
          <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>
            {fechaDeFrase(frase.dia).replace(/^./, (c) => c.toUpperCase())}
          </Text>
          <Presionable onPress={compartir} accessibilityRole="button" accessibilityLabel="Compartir la frase" hitSlop={8}
            style={({ pressed }) => ({ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Icono sf="square.and.arrow.up" respaldo="↗" tam={14} color="#FFFFFF" />
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFFFFF' }}>Compartir</Text>
          </Presionable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' }}>Tu momento de bienestar</Text>
          <Icono sf="chevron.right" respaldo="›" tam={11} color="rgba(255,255,255,0.9)" />
        </View>
      )}
    </LinearGradient>
  );

  if (grande) return cuerpo;
  // Marcada como leída: fuera del Inicio hasta la frase siguiente.
  if (leida === frase.dia) return null;
  const leer = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    marcarFraseLeida(frase.dia);
  };
  // El compacto del Inicio (2026-11-04, «siento extraño que… sólo sean cards
  // de texto»): ondas de calma dibujadas en la esquina, la comilla grande
  // encima, el rótulo como antetítulo, la frase con más cuerpo y la invitación
  // como una píldora. Toda la tarjeta se toca; la píldora dice adónde lleva.
  return (
    <Tocable etiqueta={`Frase del día: ${frase.texto}. Abre Bienestar`} alTocar={() => navegar('/bienestar')}>
      <Tarjeta estilo={{ gap: 12, overflow: 'hidden', paddingVertical: 20 }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0 }}>
          <OndasFrase tam={170} />
        </View>
        <Text importantForAccessibility="no" accessibilityElementsHidden
          style={{ position: 'absolute', right: 22, top: -30, fontSize: 140, fontWeight: '900', color: suave(t.color.magenta, t.oscuro ? 0.34 : 0.2) }}>“</Text>
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
          <Presionable onPress={leer} accessibilityRole="button" accessibilityLabel="Marcar la frase como leída" hitSlop={6}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 12, borderRadius: 999,
              opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Icono sf="checkmark.circle" respaldo="✓" tam={15} color={colorSistema.texto2} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto2 }}>Leído</Text>
          </Presionable>
        </View>
      </Tarjeta>
    </Tocable>
  );
}
