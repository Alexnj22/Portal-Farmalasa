// La frase del día (2026-11-03): una tarjeta con el degradado de su canasta,
// la comilla grande de fondo y la frase en blanco. Dos tamaños: `grande` en
// Bienestar (con la fecha y «Compartir») y el compacto del Inicio, que lleva a
// Bienestar. Los colores salen de los acentos del tema (tokens del portal).
import { Share, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import Presionable from './Presionable';
import { Tocable } from './animacion';
import { RADIO } from './ui';
import { useTema } from '../tema/tema';
import { CATEGORIAS, useFraseDelDia } from '../lib/fraseDelDia';
import { navegar } from '../lib/navegar';

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Icono sf={cat.sf} respaldo="" tam={11} color="#FFFFFF" />
          <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#FFFFFF' }}>
            FRASE DEL DÍA · {cat.nombre.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text maxFontSizeMultiplier={1.4}
        style={{ fontSize: grande ? 26 : 19, lineHeight: grande ? 33 : 25, fontWeight: '800', letterSpacing: -0.3, color: '#FFFFFF' }}>
        {frase.texto}
      </Text>

      {grande ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>
            {fechaDeFrase(frase.dia).replace(/^./, (c) => c.toUpperCase())} · mañana a las 8:00, otra
          </Text>
          <Presionable onPress={compartir} accessibilityRole="button" accessibilityLabel="Compartir la frase" hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999,
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
  return (
    <Tocable etiqueta={`Frase del día: ${frase.texto}. Abre Bienestar`} alTocar={() => navegar('/bienestar')}>
      {cuerpo}
    </Tocable>
  );
}
