// La tarjeta de socio: lo primero que ve el cliente, con la forma de una
// tarjeta de verdad (proporción 1.586, la de una tarjeta de crédito).
//
//   · Frente: degradado con los colores del logo, un brillo que se mueve con
//     la inclinación del teléfono, el nombre, «socio desde» y el saldo.
//   · Al tocarla gira en 3D (resorte) y por detrás muestra el QR con el código
//     de 7 letras: la MISMA dirección que lleva el QR del ticket
//     (`/mis-puntos?codigo=`), así que en sala se lee igual.
//
// Todo el movimiento corre en el hilo de la interfaz (Reanimated).
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import tokens from '@nucleo/constants/tokens.json';
import useInclinacion from './useInclinacion';
import { dolares, entero } from '../lib/formato';

const T = tokens.temas.solid;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const desde = (f) => {
  const m = String(f ?? '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : null;
};
const QR_DE = (codigo) => `https://portal.farmasalud.lat/mis-puntos?codigo=${codigo}`;
const RESORTE = { damping: 16, stiffness: 120, mass: 0.9 };

export default function TarjetaSocio({ nombre, saldo, equivale, codigo, socioDesde }) {
  const giro = useSharedValue(0);              // 0 = frente, 1 = reverso
  const { x, y } = useInclinacion();

  const voltear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    giro.value = withSpring(giro.value > 0.5 ? 0 : 1, RESORTE);
  };

  // La tarjeta entera se ladea apenas con el teléfono (±5°).
  const ladeo = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateX: `${-y.value * 10}deg` },
      { rotateY: `${x.value * 10}deg` },
    ],
  }));
  const frente = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(giro.value, [0, 1], [0, 180])}deg` }],
  }));
  const reverso = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(giro.value, [0, 1], [180, 360])}deg` }],
  }));
  // El brillo: una franja que cruza la tarjeta según la inclinación.
  const brillo = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * 260 }, { translateY: y.value * 120 }, { rotate: '25deg' }],
    opacity: 0.35 + Math.abs(x.value) * 0.5,
  }));

  // Primer nombre + primer apellido, la regla del portal (`shortEmployeeName`):
  // con 4 palabras el apellido es la tercera; con 3, la segunda.
  const p = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
  const nombreTarjeta = p.length >= 4 ? `${p[0]} ${p[2]}` : p.length === 3 ? `${p[0]} ${p[1]}` : p.join(' ');

  return (
    <Pressable
      onPress={voltear}
      accessibilityRole="button"
      accessibilityLabel={`Tu tarjeta de socio. Saldo ${dolares(equivale)}. Toca para ver tu código.`}
      accessibilityHint="Gira la tarjeta"
    >
      <Animated.View style={[{ aspectRatio: 1.586, width: '100%' }, ladeo]}>
        {/* ── Frente ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, frente]}>
          <LinearGradient
            colors={['#2B0B3A', T['logo-magenta'], '#5B1E9C']}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Un resplandor verde del logo en la esquina, y el brillo móvil. */}
          <LinearGradient pointerEvents="none"
            colors={['transparent', 'transparent', 'rgba(142,195,15,0.45)']}
            locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill} />
          <Animated.View pointerEvents="none" style={[estilos.brillo, brillo]}>
            <LinearGradient colors={['transparent', 'rgba(255,255,255,0.45)', 'transparent']}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>

          <View style={estilos.contenido}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Image source={require('../assets/icono.png')} style={{ width: 30, height: 30, borderRadius: 8 }} />
                <Text style={estilos.marca}>PUNTOS SALUD</Text>
              </View>
              <Text style={estilos.socio}>SOCIO</Text>
            </View>

            {/* El «chip», como en una tarjeta de verdad. */}
            <LinearGradient colors={['#F5E6A8', '#C9A64A', '#F1DC8C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={estilos.chip} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={estilos.nombre} numberOfLines={1}>{nombreTarjeta.toUpperCase()}</Text>
                {desde(socioDesde) ? <Text style={estilos.desde}>Socio desde {desde(socioDesde)}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={estilos.saldo}>{dolares(equivale)}</Text>
                <Text style={estilos.puntos}>{entero(saldo)} pts</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── Reverso: el código ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, reverso]}>
          <LinearGradient colors={['#1A0822', '#3A1048']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[estilos.contenido, { flexDirection: 'row', alignItems: 'center', gap: 18 }]}>
            <View style={estilos.qr}>
              {codigo ? <QRCode value={QR_DE(codigo)} size={118} color="#1A0822" backgroundColor="#FFFFFF" /> : null}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={estilos.socio}>TU CÓDIGO</Text>
              <Text style={estilos.codigo} adjustsFontSizeToFit numberOfLines={1}>{codigo ?? '—'}</Text>
              <Text style={estilos.ayuda}>Muéstralo en caja para usar tus puntos.</Text>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  cara: {
    borderRadius: 22, overflow: 'hidden', backfaceVisibility: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 },
  },
  brillo: { position: 'absolute', top: -80, left: 40, width: 90, height: 420 },
  contenido: { flex: 1, padding: 20, justifyContent: 'space-between' },
  marca: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  socio: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800', letterSpacing: 2.5 },
  chip: { width: 46, height: 34, borderRadius: 7 },
  nombre: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 1.5 },
  desde: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  saldo: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  puntos: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  qr: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 14 },
  codigo: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
});
