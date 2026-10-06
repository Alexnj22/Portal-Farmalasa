// La tarjeta de socio: lo primero que ve el cliente, con la forma de una
// tarjeta de verdad (proporción 1.586, la de una tarjeta de crédito).
//
//   · Frente: degradado con los colores del logo, un brillo que se mueve con
//     la inclinación del teléfono, el nombre, «socio desde» y el saldo.
//   · Al tocarla gira en 3D (resorte) y por detrás muestra el QR con el código
//     de 7 letras: la MISMA dirección que lleva el QR del ticket
//     (`/mis-puntos?codigo=`), así que en sala se lee igual.
//
// Movimiento (rehecho el 2026-10-06, a pedido: «que se vea mucho más
// increíble»), todo en el hilo de la interfaz con Reanimated y Skia:
//   · ENTRA cayendo de canto (rotateX) con un resorte, y una franja de luz la
//     cruza al llegar;
//   · se ladea con el teléfono (giroscopio SUAVIZADO con resorte: el sensor
//     crudo temblaba) y también con el DEDO: arrastrarla la inclina hacia
//     donde va el dedo y al soltarla vuelve con rebote;
//   · la luz es de verdad: holograma arcoíris, destello que sigue el ángulo y
//     un barrido que pasa solo cada pocos segundos (BrilloTarjeta);
//   · la sombra se corre al lado contrario de la inclinación;
//   · tocarla, o deslizarla rápido de lado, la GIRA: se levanta, se encoge un
//     poco a mitad del giro y vibra cuando muestra la otra cara.
import { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation, Easing, interpolate, runOnJS, useReducedMotion, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import * as Brightness from 'expo-brightness';
import tokens from '@nucleo/constants/tokens.json';
import useInclinacion from './useInclinacion';
import BrilloTarjeta from './BrilloTarjeta';
import { dolares, entero } from '../lib/formato';

const T = tokens.temas.solid;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const desde = (f) => {
  const m = String(f ?? '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : null;
};
const QR_DE = (codigo) => `https://portal.farmasalud.lat/mis-puntos?codigo=${codigo}`;
const GIRO = { damping: 15, stiffness: 110, mass: 1 };
const SUAVE = { damping: 20, stiffness: 90 };
const SOLTAR = { damping: 18, stiffness: 160 };
const limitar = (v) => { 'worklet'; return Math.max(-1, Math.min(1, v)); };
const vibrar = (fuerte) => Haptics.impactAsync(fuerte ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function TarjetaSocio({ nombre, saldo, equivale, codigo, socioDesde, activa = true }) {
  // Con «Reducir movimiento» del iPhone: sin giroscopio, sin luz que pasa.
  const reducir = useReducedMotion();
  const giro = useSharedValue(0);              // 0 = frente, 1 = reverso
  const entrada = useSharedValue(0);
  const barrido = useSharedValue(0);
  const dedoX = useSharedValue(0);
  const dedoY = useSharedValue(0);
  // El giroscopio vive en un hijo que sólo se monta con la tarjeta a la vista
  // (pestaña enfocada y app activa): antes leía cada 16 ms aunque estuvieras
  // en otra pestaña (revisión 2026-10-06).
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  // El giroscopio pasa por un resorte (sin él, el brillo temblaba) y se le
  // suma el dedo. Resultado en −1…1.
  const suaveX = useSharedValue(0);
  const suaveY = useSharedValue(0);
  useAnimatedReaction(() => [sx.value, sy.value], ([a, b]) => {
    suaveX.value = withSpring(a * 2, SUAVE);
    suaveY.value = withSpring(b * 2, SUAVE);
  });
  const x = useDerivedValue(() => limitar(suaveX.value + dedoX.value));
  const y = useDerivedValue(() => limitar(suaveY.value + dedoY.value));

  // Entrada sobria: sube un poco y aparece, sin rebote ni giro.
  useEffect(() => {
    entrada.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [entrada]);
  // La franja de luz: al llegar y cada ~6 s, sólo mientras se ve.
  useEffect(() => {
    if (!activa || reducir) { cancelAnimation(barrido); return; }
    barrido.value = 0;
    barrido.value = withDelay(500, withRepeat(withSequence(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }),
      withDelay(5000, withTiming(0, { duration: 0 })),
    ), -1));
  }, [activa, reducir, barrido]);

  const voltear = () => {
    vibrar(false);
    giro.value = withSpring(giro.value > 0.5 ? 0 : 1, GIRO);
  };
  // Con el QR a la vista, la pantalla al máximo (como Wallet), para que el
  // lector de la caja lo lea a la primera; al girarla de vuelta, como estaba.
  const brilloAntes = useRef(null);
  const brilloQr = async (mostrando) => {
    try {
      if (mostrando) {
        if (brilloAntes.current == null) brilloAntes.current = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } else if (brilloAntes.current != null) {
        await Brightness.setBrightnessAsync(brilloAntes.current);
        brilloAntes.current = null;
      }
    } catch { /* sin permiso o sin brillo: no importa */ }
  };
  useEffect(() => () => { if (brilloAntes.current != null) Brightness.setBrightnessAsync(brilloAntes.current).catch(() => {}); }, []);
  // A mitad del giro: la vibración fuerte y el brillo. Va DESPUÉS de definir
  // `brilloQr`: el worklet captura las funciones al crearse, y declarada más
  // abajo llegaba vacía — `runOnJS(undefined)` cerraba la app al girar
  // (compilación 10, 2026-10-06).
  const alCruzar = (ahora) => { vibrar(true); brilloQr(ahora); };
  useAnimatedReaction(() => giro.value > 0.5, (ahora, antes) => {
    if (antes !== null && ahora !== antes) runOnJS(alCruzar)(ahora);
  });

  // Arrastrar de lado la inclina; un deslizamiento rápido la gira. Lo vertical
  // se lo deja a la pantalla (que hace scroll).
  const arrastre = Gesture.Pan()
    .activeOffsetX([-8, 8]).failOffsetY([-14, 14])
    .onUpdate((e) => {
      dedoX.value = limitar(e.translationX / 160);
      dedoY.value = limitar(-e.translationY / 160);
    })
    .onEnd((e) => {
      dedoX.value = withSpring(0, SOLTAR);
      dedoY.value = withSpring(0, SOLTAR);
      if (Math.abs(e.velocityX) > 700) runOnJS(voltear)();
    });
  const toque = Gesture.Tap().maxDuration(300).onEnd((_e, ok) => { if (ok) runOnJS(voltear)(); });
  const gestos = Gesture.Race(arrastre, toque);

  const ladeo = useAnimatedStyle(() => {
    const medio = Math.sin(giro.value * Math.PI);          // 0 en las caras, 1 a mitad del giro
    return {
      opacity: entrada.value,
      transform: [
        { perspective: 1000 },
        // Sin levantarla al girar: subía 10 pt y tapaba lo de arriba (la campana).
        { translateY: (1 - entrada.value) * 16 },
        { rotateX: `${-y.value * 12}deg` },
        { rotateY: `${x.value * 14}deg` },
        { scale: (0.97 + entrada.value * 0.03) * (1 - medio * 0.06) },
      ],
    };
  });
  const sombra = useAnimatedStyle(() => ({
    shadowOffset: { width: -x.value * 14, height: 14 + y.value * 8 },
    shadowOpacity: 0.28 + Math.abs(x.value) * 0.12,
  }));
  const frente = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(giro.value, [0, 1], [0, 180])}deg` }],
  }));
  const reverso = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(giro.value, [0, 1], [180, 360])}deg` }],
  }));

  // Primer nombre + primer apellido, la regla del portal (`shortEmployeeName`):
  // con 4 palabras el apellido es la tercera; con 3, la segunda.
  const p = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
  const nombreTarjeta = p.length >= 4 ? `${p[0]} ${p[2]}` : p.length === 3 ? `${p[0]} ${p[1]}` : p.join(' ');

  return (
    <>
    {activa && !reducir ? <Sensor salidaX={sx} salidaY={sy} /> : null}
    <GestureDetector gesture={gestos}>
      <Animated.View style={[{ aspectRatio: 1.586, width: '100%' }, estilos.sombra, sombra, ladeo]}
        accessible accessibilityRole="button"
        accessibilityLabel={`Tu tarjeta de socio. Saldo ${dolares(equivale)}. Toca para ver tu código.`}
        accessibilityHint="Gira la tarjeta" onAccessibilityTap={voltear}>
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
          <BrilloTarjeta x={x} y={y} barrido={barrido} />

          {/* El logo al centro: llena el espacio entre el chip y el nombre
              (pedido del usuario, 2026-10-06), con un halo suave. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={estilos.halo}>
              <Image source={require('../assets/icono.png')} style={{ width: 64, height: 64, borderRadius: 16 }} />
            </View>
          </View>

          <View style={estilos.contenido}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Image source={require('../assets/icono.png')} style={{ width: 30, height: 30, borderRadius: 8 }} />
                <Text maxFontSizeMultiplier={1.3} style={estilos.marca}>PUNTOS SALUD</Text>
              </View>
              <Text maxFontSizeMultiplier={1.3} style={estilos.socio}>SOCIO</Text>
            </View>

            {/* El «chip», como en una tarjeta de verdad. */}
            <LinearGradient colors={['#F5E6A8', '#C9A64A', '#F1DC8C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={estilos.chip} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text maxFontSizeMultiplier={1.3} style={estilos.nombre} numberOfLines={1}>{nombreTarjeta.toUpperCase()}</Text>
                {desde(socioDesde) ? <Text maxFontSizeMultiplier={1.3} style={estilos.desde}>Socio desde {desde(socioDesde)}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text maxFontSizeMultiplier={1.3} adjustsFontSizeToFit numberOfLines={1} style={estilos.saldo}>{dolares(equivale)}</Text>
                <Text maxFontSizeMultiplier={1.3} style={estilos.puntos}>{entero(saldo)} pts</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── Reverso: el código ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, reverso]}>
          <LinearGradient colors={['#1A0822', '#3A1048']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <BrilloTarjeta x={x} y={y} barrido={barrido} />
          <View style={[estilos.contenido, { flexDirection: 'row', alignItems: 'center', gap: 18 }]}>
            <View style={estilos.qr}>
              {codigo ? <QRCode value={QR_DE(codigo)} size={118} color="#1A0822" backgroundColor="#FFFFFF" /> : null}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text maxFontSizeMultiplier={1.3} style={estilos.socio}>TU CÓDIGO</Text>
              <Text maxFontSizeMultiplier={1.3} style={estilos.codigo} adjustsFontSizeToFit numberOfLines={1}>{codigo ?? '—'}</Text>
              <Text maxFontSizeMultiplier={1.3} style={estilos.ayuda}>Muéstralo en caja para usar tus puntos.</Text>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
    </>
  );
}

// El giroscopio, montado sólo mientras la tarjeta se ve: al desmontarse, el
// sensor se suelta y deja de leer.
function Sensor({ salidaX, salidaY }) {
  const { x, y } = useInclinacion();
  useAnimatedReaction(() => [x.value, y.value], ([a, b]) => { salidaX.value = a; salidaY.value = b; });
  return null;
}

const estilos = StyleSheet.create({
  cara: { borderRadius: 22, overflow: 'hidden', backfaceVisibility: 'hidden' },
  sombra: { shadowColor: '#2B0B3A', shadowRadius: 22, borderRadius: 22 },
  contenido: { flex: 1, padding: 20, justifyContent: 'space-between' },
  marca: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  socio: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800', letterSpacing: 2.5 },
  chip: { width: 46, height: 34, borderRadius: 7 },
  halo: {
    padding: 6, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  nombre: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 1.5 },
  desde: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  saldo: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  puntos: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  qr: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 14 },
  codigo: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
});
