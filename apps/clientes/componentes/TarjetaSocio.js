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
import EfectoNivel from './EfectoNivel';
import Mineral, { MATERIALES } from './minerales/Mineral';
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
import { NumeroAnimado } from './animacion';

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

// Los colores de cada nivel (plan aprobado 2026-10-07): morada (Cliente VIP),
// plata, dorada y platino. El texto queda blanco en las cuatro.
export const COLORES_NIVEL = {
  // El COLOR dice el nivel; los efectos sólo lo acompañan, suaves (2026-10-07):
  //   VIP morado de la marca · Plata gris metálico · Oro dorado ·
  //   Platino negro (la «black card»), con un brillo apenas iridiscente.
  // El nivel de entrada es Bronce (Reglamento v2, cláusula 4); su clave sigue 'vip'.
  vip: { frente: ['#3A1A08', '#9A5A2C', '#5A2E12'], reverso: ['#24100A', '#5A2E12'], rotulo: 'BRONCE', sombra: '#5A2E12', acento: '#F2B07A' },
  // Bronce: el nivel de entrada del Reglamento v2 (hoy sólo en modo de prueba).
  bronce: { frente: ['#3A1A08', '#9A5A2C', '#5A2E12'], reverso: ['#24100A', '#5A2E12'], rotulo: 'BRONCE', sombra: '#5A2E12', acento: '#F2B07A' },
  plata: { frente: ['#4A525E', '#A9B2BE', '#5E6774'], reverso: ['#2A3038', '#4A525E'], rotulo: 'PLATA', sombra: '#4A525E', acento: '#DCE3EC' },
  oro: { frente: ['#7A4A00', '#E0A93A', '#9A6408'], reverso: ['#3F2600', '#7A4A00'], rotulo: 'ORO', sombra: '#9A6408', acento: '#FFD978' },
  platino: { frente: ['#08090C', '#262A33', '#08090C'], reverso: ['#000000', '#16181E'], rotulo: 'PLATINO', sombra: '#000000', acento: '#E8ECF2' },
  // Equipo (empleados): carbono con la franja de la marca.
  empleado: { frente: ['#0B0B0E', '#2A2A30', '#0B0B0E'], reverso: ['#000000', '#16161A'], rotulo: 'EQUIPO', sombra: '#000000', acento: '#E06BC2' },
  // Cliente Mayorista (2026-10-08, en modo de prueba): sus rangos son piedras,
  // cada una con su color — Jade, Zafiro, Rubí y Diamante.
  jade: { frente: ['#06281F', '#1F9E77', '#0B4D3A'], reverso: ['#041A14', '#0B4D3A'], rotulo: 'JADE', sombra: '#0B4D3A', acento: '#8CF5CE' },
  zafiro: { frente: ['#061440', '#2E5BD6', '#0A2470'], reverso: ['#040C2A', '#0A2470'], rotulo: 'ZAFIRO', sombra: '#0A2470', acento: '#A9C2FF' },
  rubi: { frente: ['#3A0410', '#C0163A', '#62081C'], reverso: ['#24020A', '#62081C'], rotulo: 'RUBÍ', sombra: '#62081C', acento: '#FF9AAE' },
  diamante: { frente: ['#18222E', '#8FB3CF', '#26384A'], reverso: ['#0E151D', '#26384A'], rotulo: 'DIAMANTE', sombra: '#26384A', acento: '#EAF6FF' },
};

// `previo` y `cambio` (2026-10-08): el saldo anterior y la diferencia. Con
// ellos el monto CUENTA hasta el nuevo (sube o baja), sale una etiqueta
// «+250 pts» / «−500 pts» que flota hacia arriba y la tarjeta destella en
// verde o en rojo.
export default function TarjetaSocio({ nombre, saldo, equivale, codigo, socioDesde, nivel: nivelDado = 'vip', activa = true, previo = null, cambio = null }) {
  // 'vip' es la clave del nivel de entrada, que ahora es Bronce: lleva su material.
  const nivel = nivelDado === 'vip' ? 'bronce' : nivelDado;
  const paleta = COLORES_NIVEL[nivel] ?? COLORES_NIVEL.vip;
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

  // El brillo se pide AL TOCAR, no a mitad del giro (2026-10-08): desde la
  // reacción del giro no llegaba siempre, y el QR quedaba con la pantalla oscura.
  const voltear = () => {
    vibrar(false);
    const aReverso = giro.value <= 0.5;
    giro.value = withSpring(aReverso ? 1 : 0, GIRO);
    brilloQr(aReverso);
  };
  // Con el QR a la vista, la pantalla al máximo (como Wallet), para que el
  // lector de la caja lo lea a la primera; al girarla de vuelta, como estaba.
  const brilloAntes = useRef(null);
  async function brilloQr(mostrando) {
    try {
      if (mostrando) {
        if (brilloAntes.current == null) brilloAntes.current = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } else if (brilloAntes.current != null) {
        await Brightness.setBrightnessAsync(brilloAntes.current);
        brilloAntes.current = null;
      }
    } catch { /* sin permiso o sin brillo: no importa */ }
  }
  useEffect(() => () => { if (brilloAntes.current != null) Brightness.setBrightnessAsync(brilloAntes.current).catch(() => {}); }, []);
  // Al salir de la pestaña (o mandar la app al fondo) con el QR a la vista,
  // la pantalla vuelve a su brillo; al volver, si sigue el reverso, al máximo.
  useEffect(() => {
    if (giro.value > 0.5) brilloQr(activa);
  }, [activa]); // eslint-disable-line react-hooks/exhaustive-deps
  // A mitad del giro: la vibración fuerte y el brillo. Va DESPUÉS de definir
  // `brilloQr`: el worklet captura las funciones al crearse, y declarada más
  // abajo llegaba vacía — `runOnJS(undefined)` cerraba la app al girar
  // (compilación 10, 2026-10-06).
  const alCruzar = () => { vibrar(true); };
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
      <Animated.View style={[{ aspectRatio: 1.586, width: '100%' }, estilos.sombra, { shadowColor: paleta.sombra }, sombra, ladeo]}
        accessible accessibilityRole="button"
        accessibilityLabel={`Tu tarjeta ${paleta.rotulo.toLowerCase()}. Saldo ${dolares(equivale)}. Toca para ver tu código.`}
        accessibilityHint="Gira la tarjeta" onAccessibilityTap={voltear}>
        {/* ── Frente ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, frente]}>
          <LinearGradient
            colors={paleta.frente}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* El material (2026-10-08): metal o piedra según el nivel o el rango,
              vivo con la inclinación. El degradado de arriba queda de respaldo. */}
          {MATERIALES.includes(nivel) ? <Mineral material={nivel} x={x} y={y} activa={activa && !reducir} />
            : <EfectoNivel nivel={nivel} activa={activa && !reducir} x={x} />}
          {/* Una sombra suave abajo: el nombre y el saldo se leen sobre cualquier material. */}
          <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.38)']}
            locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
          <BrilloTarjeta x={x} y={y} barrido={barrido} sinArcoiris={MATERIALES.includes(nivel)} />

          {/* El logo al centro: llena el espacio entre el chip y el nombre
              (pedido del usuario, 2026-10-06), con un halo suave. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Medallon tam={92} />
          </View>

          <View style={estilos.contenido}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Medallon tam={34} />
                <Text maxFontSizeMultiplier={1.3} style={estilos.marca}>PUNTOS SALUD</Text>
              </View>
              <Text maxFontSizeMultiplier={1.3} style={estilos.socio}>{paleta.rotulo}</Text>
            </View>

            {/* El «chip», como en una tarjeta de verdad. */}
            <LinearGradient colors={['#F5E6A8', '#C9A64A', '#F1DC8C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={estilos.chip} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text maxFontSizeMultiplier={1.3} style={estilos.nombre} numberOfLines={1}>{nombreTarjeta.toUpperCase()}</Text>
                {desde(socioDesde) ? <Text maxFontSizeMultiplier={1.3} style={estilos.desde}>Socio desde {desde(socioDesde)}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <NumeroAnimado key={`s${cambio?.id ?? 0}`} valor={equivale} desde={previo?.equivale ?? equivale} duracion={1200} estilo={[estilos.saldo, { textAlign: 'right' }]} />
                <View style={{ flexDirection: 'row' }}>
                  <NumeroAnimado key={`p${cambio?.id ?? 0}`} valor={saldo} desde={previo?.saldo ?? saldo} formato="entero" duracion={1200} estilo={[estilos.puntos, { textAlign: 'right' }]} />
                  <Text maxFontSizeMultiplier={1.3} style={estilos.puntos}> pts</Text>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        {cambio ? <CambioDeSaldo key={cambio.id} delta={cambio.delta} /> : null}

        {/* ── Reverso: el código ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, reverso]}>
          <LinearGradient colors={paleta.reverso} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {/* El mismo material del frente, más oscuro para que el código se lea.
              Sigue la inclinación, pero su reloj va quieto (no gasta dos veces). */}
          {MATERIALES.includes(nivel) ? <Mineral material={nivel} x={x} y={y} activa={false} />
            : <EfectoNivel nivel={nivel} activa={activa && !reducir} x={x} />}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.42)' }]} />
          <BrilloTarjeta x={x} y={y} barrido={barrido} sinArcoiris={MATERIALES.includes(nivel)} />
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

// El logo como MEDALLÓN acuñado (2026-10-08): sobre zafiro, rubí o carbono el
// logo de color se perdía. Va sobre una cara blanca con bisel —luz arriba a
// la izquierda, sombra abajo a la derecha— y sombra propia, así se lee sobre
// cualquier material y parece incrustado en la tarjeta.
function Medallon({ tam }) {
  const r = tam / 2;
  return (
    <View style={{ width: tam, height: tam, borderRadius: r, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: tam * 0.12, shadowOffset: { width: 0, height: tam * 0.05 } }}>
      {/* El bisel del borde. */}
      <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0.55)', 'rgba(120,120,130,0.9)']} locations={[0, 0.45, 1]}
        start={{ x: 0.15, y: 0.1 }} end={{ x: 0.85, y: 0.95 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: r }} />
      {/* La cara, un poco hundida: sombra interior arriba, luz abajo. */}
      <View style={{ position: 'absolute', top: tam * 0.07, left: tam * 0.07, right: tam * 0.07, bottom: tam * 0.07, borderRadius: r, overflow: 'hidden', backgroundColor: '#FBFAFC' }}>
        <LinearGradient colors={['rgba(0,0,0,0.10)', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.0)']} locations={[0, 0.35, 1]}
          start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Image source={require('../assets/icono.png')} style={{ width: tam * 0.72, height: tam * 0.72, borderRadius: tam * 0.36 }} />
      </View>
    </View>
  );
}

// La etiqueta que flota al sumar o restar puntos, y el destello de la tarjeta.
function CambioDeSaldo({ delta }) {
  const v = useSharedValue(0);
  const flash = useSharedValue(0);
  const suma = delta > 0;
  useEffect(() => {
    Haptics.notificationAsync(suma ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    v.value = withDelay(250, withTiming(1, { duration: 1700, easing: Easing.out(Easing.cubic) }));
    flash.value = withSequence(withTiming(1, { duration: 180 }), withTiming(0, { duration: 900 }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const etiqueta = useAnimatedStyle(() => ({
    opacity: v.value < 0.75 ? Math.min(1, v.value * 6) : (1 - v.value) * 4,
    transform: [{ translateY: -v.value * 70 }, { scale: v.value < 0.15 ? 0.6 + v.value * 3.4 : 1.11 - v.value * 0.11 }],
  }));
  const borde = useAnimatedStyle(() => ({ opacity: flash.value }));
  const color = suma ? '#34C759' : '#FF453A';
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 22, borderWidth: 3, borderColor: color, backgroundColor: suma ? 'rgba(52,199,89,0.14)' : 'rgba(255,69,58,0.14)' }, borde]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 18, bottom: 62, backgroundColor: color, borderRadius: 999,
        paddingHorizontal: 12, paddingVertical: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, etiqueta]}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] }}>
          {suma ? '+' : '−'}{entero(Math.abs(delta))} pts
        </Text>
      </Animated.View>
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
  marca: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 2, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 5 },
  socio: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800', letterSpacing: 2.5 },
  chip: { width: 46, height: 34, borderRadius: 7 },
  halo: {
    padding: 6, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  nombre: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 1.5, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  desde: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  saldo: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8 },
  puntos: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  qr: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 14 },
  codigo: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
});
