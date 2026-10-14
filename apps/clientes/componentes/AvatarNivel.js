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

export default function AvatarNivel({ nombre, material, equipo = false, uri, clave, tam = 64, atenuado = false }) {
  const t = useTema();
  const paleta = material ? (COLORES_NIVEL[material === 'vip' ? 'bronce' : material] ?? null) : equipo ? COLORES_NIVEL.empleado : null;
  const anillo = 3;
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
  return (
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
}
