// El avatar de Cuenta con el NIVEL (2026-10-14, «no me muestra en el avatar mi
// nivel ni nada»). Como en el portal: un anillo del color del material de la
// tarjeta —Bronce, Plata, Oro, Platino; los rangos de mayoreo Jade, Zafiro,
// Rubí y Diamante—, sacado de COLORES_NIVEL de TarjetaSocio para que el anillo
// y la tarjeta sean siempre el mismo metal o la misma piedra.
//
// Mientras la foto llega se ven las iniciales (al instante, sin red); la foto
// entra con un fundido encima. La caché va por la RUTA de la foto y no por la
// URL firmada (lib/fotoPerfil.js).
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORES_NIVEL } from './TarjetaSocio';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

const MAYOREO = ['jade', 'zafiro', 'rubi', 'diamante'];
const NOMBRE_RANGO = { jade: 'Jade', zafiro: 'Zafiro', rubi: 'Rubí', diamante: 'Diamante' };
const NOMBRE_NIVEL = { vip: 'Bronce', bronce: 'Bronce', plata: 'Plata', oro: 'Oro', platino: 'Platino' };

/** «Nivel Platino», «Cliente Mayorista · Rubí», con « · Team» si es del equipo. */
export function rotuloNivel(material, equipo) {
  if (!material) return equipo ? 'Team Farmacia Salud' : null;
  const base = MAYOREO.includes(material) ? `Cliente Mayorista · ${NOMBRE_RANGO[material]}` : `Nivel ${NOMBRE_NIVEL[material] ?? ''}`.trim();
  return equipo ? `${base} · Team` : base;
}

// Primer nombre + primer apellido, la regla de la tarjeta.
function iniciales(nombre) {
  const p = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
  const ap = p.length >= 4 ? p[2] : p.length >= 2 ? p[1] : '';
  return `${p[0]?.[0] ?? ''}${ap?.[0] ?? ''}`.toUpperCase();
}

// `insignia` (2026-10-20, Cuenta: «el aro no se distingue qué nivel es, dame
// una mejor presentación»): debajo de la foto, montada sobre el aro, una
// placa con el NOMBRE del nivel en su mismo metal o piedra (y «TEAM» si es del
// equipo). El aro además es más grueso y brilla del tono del nivel: con 3 pt
// de metal sobre la aurora, Oro y Bronce se confundían.
export default function AvatarNivel({ nombre, material, equipo = false, uri, clave, tam = 64, atenuado = false, insignia = false }) {
  const t = useTema();
  const paleta = material ? (COLORES_NIVEL[material === 'vip' ? 'bronce' : material] ?? null) : equipo ? COLORES_NIVEL.empleado : null;
  const anillo = insignia ? Math.max(4, Math.round(tam * 0.055)) : 3;
  const hueco = 1.5;
  const interior = tam - 2 * (anillo + hueco);
  // El hueco va del tono hondo del mismo material (un bisel), no del fondo:
  // en iPhone el fondo es la aurora y un color fijo se veía como un disco.
  const fondoHueco = paleta ? paleta.frente[0] : 'transparent';
  const cara = (
    <View style={{ width: interior, height: interior, borderRadius: interior / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
      backgroundColor: paleta ? paleta.frente[1] : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)'), opacity: atenuado ? 0.5 : 1 }}>
      {/* Las iniciales debajo: se ven al instante y quedan si la foto no llega. */}
      {nombre ? (
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: interior * 0.38, fontWeight: '800', color: paleta ? '#FFFFFF' : colorSistema.texto2, letterSpacing: 0.5 }}>
          {iniciales(nombre)}
        </Text>
      ) : <Icono sf="person.fill" respaldo="👤" tam={interior * 0.45} color={colorSistema.texto3} />}
      {uri ? (
        <Image source={{ uri, cacheKey: clave ?? undefined }} recyclingKey={clave ?? uri} cachePolicy="memory-disk" transition={180}
          style={{ position: 'absolute', left: 0, top: 0, width: interior, height: interior }} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : null}
    </View>
  );
  if (!paleta) return <View style={{ width: tam, height: tam, alignItems: 'center', justifyContent: 'center' }}>{cara}</View>;
  const aro = (
    // El anillo: el metal de la tarjeta (tono → reflejo → hondo → reflejo) y,
    // entre el anillo y la foto, un bisel fino del tono hondo.
    <LinearGradient colors={[paleta.frente[1], paleta.acento, paleta.frente[0], paleta.acento]} locations={[0, 0.35, 0.7, 1]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: tam, height: tam, borderRadius: tam / 2, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: tam - 2 * anillo, height: tam - 2 * anillo, borderRadius: (tam - 2 * anillo) / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: fondoHueco }}>
        {cara}
      </View>
    </LinearGradient>
  );
  if (!insignia) return aro;
  const claveNivel = material === 'vip' ? 'bronce' : material;
  const nombreNivel = material ? (NOMBRE_RANGO[claveNivel] ?? NOMBRE_NIVEL[claveNivel] ?? '') : '';
  // Del equipo (2026-10-20, «donde dice Bronce, si es team, se ve cortado»):
  // «BRONCE · TEAM» no cabía en el ancho de la foto y se cortaba. Ahora son
  // DOS placas lado a lado —el nivel en su metal y «TEAM» en el negro con
  // acento de la tarjeta del equipo— y pueden salir del ancho de la foto.
  const equipoPaleta = COLORES_NIVEL.empleado;
  const placa = (colores, borde, icono, respaldo, texto) => (
    <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: borde }}>
      <Icono sf={icono} respaldo={respaldo} tam={10} color="#FFFFFF" />
      <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 1.4,
        textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }}>{texto}</Text>
    </LinearGradient>
  );
  return (
    <View style={{ width: tam, height: tam + 12, alignItems: 'center' }}>
      {/* El brillo del nivel alrededor del aro. */}
      <View style={{ width: tam, height: tam, borderRadius: tam / 2, shadowColor: paleta.acento, shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
        backgroundColor: paleta.frente[0] }}>
        {aro}
      </View>
      {nombreNivel || equipo ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: -90, right: -90, flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
          {nombreNivel ? placa([paleta.frente[0], paleta.frente[1], paleta.frente[2] ?? paleta.frente[0]], paleta.acento,
            MAYOREO.includes(claveNivel) ? 'diamond.fill' : 'crown.fill', '★', nombreNivel.toUpperCase()) : null}
          {equipo ? placa([equipoPaleta.frente[1], equipoPaleta.frente[0]], equipoPaleta.acento, 'person.2.fill', '●', 'TEAM') : null}
        </View>
      ) : null}
    </View>
  );
}
