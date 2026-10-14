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
import { useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import EfectoNivel from './EfectoNivel';
import Mineral, { MATERIALES } from './minerales/Mineral';
import LogoEnRelieve from './minerales/LogoEnRelieve';
import SelloEquipo from './minerales/SelloEquipo';
import RotuloLamina from './minerales/RotuloLamina';
import { despertar, useDespierta } from './reposo';
import { Momento, vibrarMomento } from './momentos';
import { AccessibilityInfo, Image, StyleSheet, Text, View } from 'react-native';
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
import { ANDROID, LIVIANO } from '../lib/rendimiento';
import BrilloTarjeta from './BrilloTarjeta';
import { dolares, entero } from '../lib/formato';
import { NumeroAnimado } from './animacion';

const T = tokens.temas.solid;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
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
// La pista de «tócala para girarla»: el asomo es una vez por sesión de la app.
let yaGiro = false;
const CLAVE_PISTA = 'puntos_salud_tarjeta_girada';
// El código letra por letra: junto, VoiceOver lo leía como una palabra.
const deletrear = (c) => String(c).split('').join(' ');

export default function TarjetaSocio({ nombre, saldo, equivale, codigo, socioDesde, nivel: nivelDado = 'vip', activa = true, previo = null, cambio = null, equipo = false, estiloLogo = 'material' }) {
  // 'vip' es la clave del nivel de entrada, que ahora es Bronce: lleva su material.
  const nivel = nivelDado === 'vip' ? 'bronce' : nivelDado;
  const paleta = COLORES_NIVEL[nivel] ?? COLORES_NIVEL.vip;
  // Con «Reducir movimiento» del iPhone: sin giroscopio, sin luz que pasa.
  // Movimiento reducido o teléfono antiguo: material quieto, sin giroscopio.
  const reducir = useReducedMotion() || LIVIANO;
  // Platino, la tarjeta más alta de clientes (2026-10-14, «que se note que es
  // la full»): rótulo en lámina, capas con profundidad al inclinar y el
  // material propio (minerales/shaders.js).
  const exclusiva = nivel === 'platino';
  // Reposo (componentes/reposo.js, 2026-10-14, «se calienta»): a los 20 s sin
  // tocar ni inclinar, el material, la luz que pasa y el giroscopio a ritmo
  // pleno se detienen; la tarjeta queda igual, quieta. Tocar o inclinar la despierta.
  const despierta = useDespierta(activa && !reducir);
  const viva = activa && !reducir && despierta;
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
    // Zona muerta (2026-10-14): el pulso de la mano movía el sensor una
    // milésima y el resorte nunca se asentaba — el lienzo se redibujaba cada
    // cuadro con la tarjeta «quieta».
    if (Math.abs(a * 2 - suaveX.value) + Math.abs(b * 2 - suaveY.value) < 0.012) return;
    suaveX.value = withSpring(a * 2, SUAVE);
    suaveY.value = withSpring(b * 2, SUAVE);
  });
  const x = useDerivedValue(() => limitar(suaveX.value + dedoX.value));
  const y = useDerivedValue(() => limitar(suaveY.value + dedoY.value));

  // Entrada sobria: sube un poco y aparece, sin rebote ni giro.
  useEffect(() => {
    entrada.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [entrada]);
  // Que se ENTIENDA que se toca y se gira (2026-10-09): una vez por sesión,
  // si todavía no la giró, la tarjeta «asoma» el reverso y vuelve; y debajo,
  // la pista «Toca la tarjeta…» hasta la primera vez que la gire.
  const [pista, setPista] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(CLAVE_PISTA).then((v) => setPista(v !== '1')).catch(() => {});
  }, []);
  useEffect(() => {
    if (!activa || reducir || yaGiro) return;
    yaGiro = true;
    giro.value = withDelay(1400, withSequence(
      withTiming(0.16, { duration: 420, easing: Easing.out(Easing.cubic) }),
      withSpring(0, GIRO),
    ));
  }, [activa]); // eslint-disable-line react-hooks/exhaustive-deps
  // La franja de luz: al llegar y cada ~6 s, sólo mientras se ve.
  useEffect(() => {
    if (!viva) { cancelAnimation(barrido); barrido.value = 0; return; }
    barrido.value = 0;
    barrido.value = withDelay(500, withRepeat(withSequence(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }),
      withDelay(5000, withTiming(0, { duration: 0 })),
    ), -1));
  }, [viva, barrido]);

  // El brillo se pide AL TOCAR, no a mitad del giro (2026-10-08): desde la
  // reacción del giro no llegaba siempre, y el QR quedaba con la pantalla oscura.
  // Qué cara se ve, para VoiceOver (2026-10-13): con el reverso a la vista
  // el rótulo tiene que leer el código, no el saldo del frente.
  const [deReves, setDeReves] = useState(false);
  const voltear = () => {
    yaGiro = true;
    if (pista) { setPista(false); SecureStore.setItemAsync(CLAVE_PISTA, '1').catch(() => {}); }
    vibrar(false);
    const aReverso = giro.value <= 0.5;
    giro.value = withSpring(aReverso ? 1 : 0, GIRO);
    brilloQr(aReverso);
    setDeReves(aReverso);
    if (aReverso && codigo) AccessibilityInfo.announceForAccessibility(`Tu código: ${deletrear(codigo)}`);
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
  // Qué cara mira al frente AHORA (cambia justo a mitad del giro): en
  // Android decide qué lienzos se dibujan (ver `verFrente`).
  const [caraAtras, setCaraAtras] = useState(false);
  const alCruzar = (atras) => { vibrar(true); if (ANDROID) setCaraAtras(!!atras); };
  useAnimatedReaction(() => giro.value > 0.5, (ahora, antes) => {
    if (antes !== null && ahora !== antes) runOnJS(alCruzar)(ahora);
  });

  // Arrastrar de lado la inclina; un deslizamiento rápido la gira. Lo vertical
  // se lo deja a la pantalla (que hace scroll).
  const arrastre = Gesture.Pan()
    .activeOffsetX([-8, 8]).failOffsetY([-14, 14])
    .onBegin(() => { runOnJS(despertar)(); })
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
  // Mantenerla presionada (2026-10-14): una ráfaga de luz la cruza y el
  // teléfono responde con dos golpes hápticos. Sólo de frente.
  const rafaga = useSharedValue(0);
  const alRafaga = () => {
    despertar();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 140);
  };
  const largo = Gesture.LongPress().minDuration(420).onStart(() => {
    if (giro.value > 0.5) return;
    rafaga.value = 0;
    rafaga.value = withTiming(1, { duration: 950, easing: Easing.out(Easing.cubic) });
    runOnJS(alRafaga)();
  });
  const gestos = Gesture.Race(arrastre, largo, toque);
  // Profundidad (Platino): el contenido flota sobre el material y el logo un
  // poco más; al inclinar, cada capa se corre distinto — paralaje.
  const capaTexto = useAnimatedStyle(() => (exclusiva ? { transform: [{ translateX: -x.value * 3 }, { translateY: y.value * 2 }] } : {}));
  const capaLogo = useAnimatedStyle(() => (exclusiva ? { transform: [{ translateX: -x.value * 6 }, { translateY: y.value * 4 }] } : {}));

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
  // La sombra que se corre: en Android las `shadow*` no existen (allá es
  // `elevation`, que no sigue la inclinación), así que ni se calcula — era un
  // estilo animado recalculado en cada cuadro para nada (2026-10-13).
  const sombra = useAnimatedStyle(() => (ANDROID ? {} : {
    shadowOffset: { width: -x.value * 14, height: 14 + y.value * 8 },
    shadowOpacity: 0.28 + Math.abs(x.value) * 0.12,
  }));
  // Android (2026-10-13): una cara a la vez. La cara de atrás está oculta
  // (`backfaceVisibility`), pero sus lienzos de Skia —el material y la luz—
  // se seguían redibujando con cada movimiento del giroscopio: dos tarjetas
  // pintadas para ver una. Se monta la que mira al frente, y el cambio es a
  // mitad del giro, cuando la otra queda de canto.
  const verFrente = !ANDROID || !caraAtras;
  const verReverso = !ANDROID || caraAtras;
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
    {activa && !reducir ? <Sensor key={despierta ? 'viva' : 'reposo'} salidaX={sx} salidaY={sy} enReposo={!despierta} /> : null}
    <GestureDetector gesture={gestos}>
      <Animated.View style={[{ aspectRatio: 1.586, width: '100%' }, estilos.sombra, { shadowColor: paleta.sombra }, sombra, ladeo]}
        accessible accessibilityRole="button"
        accessibilityLabel={deReves
          ? `Tu código: ${codigo ? deletrear(codigo) : 'sin código'}. Muéstralo en caja para usar tus puntos.`
          : `Tu tarjeta ${paleta.rotulo.toLowerCase()}${equipo ? ', del Team Farmacia Salud' : ''}. Saldo ${dolares(equivale)}. Toca para ver tu código.`}
        accessibilityHint={deReves ? 'Gira la tarjeta al frente' : 'Gira la tarjeta'} onAccessibilityTap={voltear}>
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
          {/* `key`: al cambiar de nivel o rango el lienzo se rehace entero; sin
              eso podía quedar pintado el material anterior. */}
          {!verFrente ? null : MATERIALES.includes(nivel) ? <Mineral key={nivel} material={nivel} x={x} y={y} activa={viva} />
            : <EfectoNivel nivel={nivel} activa={viva} x={x} />}
          {/* Una sombra suave abajo: el nombre y el saldo se leen sobre cualquier material. */}
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.30)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.50)']}
            locations={[0, 0.28, 0.55, 1]} style={StyleSheet.absoluteFill} />
          {verFrente ? <BrilloTarjeta x={x} y={y} barrido={barrido} sinArcoiris={MATERIALES.includes(nivel)} /> : null}

          {/* El logo al centro: llena el espacio entre el chip y el nombre
              (pedido del usuario, 2026-10-06), con un halo suave. */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, capaLogo]}>
            <LogoEnRelieve tam={84} x={x} y={y} estilo={estiloLogo} />
          </Animated.View>

          <Animated.View style={[estilos.contenido, capaTexto]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {/* El efecto es sólo del logo central; éste va plano. */}
                <Image source={require('../assets/icono.png')} style={{ width: 30, height: 30, tintColor: '#FFFFFF' }} />
                <Text maxFontSizeMultiplier={1.3} style={estilos.marca}>PUNTOS SALUD</Text>
              </View>
              {/* Qué tarjeta es, siempre en dos renglones (2026-10-09): «CLIENTE» sobre
                  el nivel (Bronce…Platino) o «MAYOREO» sobre el rango (Jade…Diamante). */}
              <View style={{ alignItems: 'flex-end', gap: 1 }}>
                <Text maxFontSizeMultiplier={1.2} style={[estilos.socio, { fontSize: 8.5, letterSpacing: 1.8, opacity: 0.85 }]}>
                  {['jade', 'zafiro', 'rubi', 'diamante'].includes(nivel) ? 'MAYOREO' : 'CLIENTE'}
                </Text>
                {exclusiva
                  ? <RotuloLamina texto={paleta.rotulo} tam={15} espacio={3} x={x} y={y} estiloRespaldo={estilos.socio} />
                  : <Text maxFontSizeMultiplier={1.3} style={estilos.socio}>{paleta.rotulo}</Text>}
              </View>
            </View>

            {/* El «chip», como en una tarjeta de verdad; al personal, a su lado
                derecho, el sello holográfico de PERSONAL (2026-10-08). */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <ChipOro x={x} />
              {equipo ? <SelloEquipo x={x} y={y} activa={viva} /> : null}
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text maxFontSizeMultiplier={1.3} style={estilos.nombre} numberOfLines={1}>{nombreTarjeta.toUpperCase()}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <NumeroAnimado key={`s${cambio?.id ?? 0}`} valor={equivale} desde={previo?.equivale ?? equivale} duracion={1200} estilo={[estilos.saldo, { textAlign: 'right' }]} />
                <View style={{ flexDirection: 'row' }}>
                  <NumeroAnimado key={`p${cambio?.id ?? 0}`} valor={saldo} desde={previo?.saldo ?? saldo} formato="entero" duracion={1200} estilo={[estilos.puntos, { textAlign: 'right' }]} />
                  <Text maxFontSizeMultiplier={1.3} style={estilos.puntos}> pts</Text>
                </View>
              </View>
            </View>
          </Animated.View>
          {verFrente ? <Rafaga v={rafaga} /> : null}
        </Animated.View>

        {cambio ? <CambioDeSaldo key={cambio.id} delta={cambio.delta} material={nivel} /> : null}

        {/* ── Reverso: el código ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, reverso]}>
          <LinearGradient colors={paleta.reverso} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {/* El mismo material del frente, más oscuro para que el código se lea.
              Sigue la inclinación, pero su reloj va quieto (no gasta dos veces). */}
          {!verReverso ? null : MATERIALES.includes(nivel) ? <Mineral key={nivel} material={nivel} x={x} y={y} activa={false} />
            : <EfectoNivel nivel={nivel} activa={viva} x={x} />}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.42)' }]} />
          {verReverso ? <BrilloTarjeta x={x} y={y} barrido={barrido} sinArcoiris={MATERIALES.includes(nivel)} /> : null}
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
    {pista ? (
      <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: 'rgba(140,140,150,1)' }}>↻  Toca la tarjeta para ver tu código · inclínala para ver el brillo</Text>
      </View>
    ) : null}
    </>
  );
}

// El logo como MEDALLÓN acuñado (2026-10-08): sobre zafiro, rubí o carbono el
// logo de color se perdía. Va sobre una cara blanca con bisel —luz arriba a
// la izquierda, sombra abajo a la derecha— y sombra propia, así se lee sobre
// cualquier material y parece incrustado en la tarjeta.

// El chip (2026-10-09, «no brilla como oro, se ve plano»): oro con volumen
// —sombra en un borde, luz en el otro—, las pistas de contacto grabadas y un
// reflejo que lo cruza siguiendo la inclinación.
function ChipOro({ x }) {
  const reflejo = useAnimatedStyle(() => ({ transform: [{ translateX: (x ? x.value : 0) * 34 }, { rotate: '20deg' }] }));
  return (
    <View style={[estilos.chip, { overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(90,60,0,0.55)' }]}>
      <LinearGradient colors={['#FFF1B8', '#E8B94A', '#A8741A', '#F6D77A', '#C8902A']} locations={[0, 0.3, 0.55, 0.78, 1]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Las pistas de contacto, grabadas. */}
      <View style={{ position: 'absolute', left: '33%', top: 0, bottom: 0, width: 0.8, backgroundColor: 'rgba(100,66,0,0.45)' }} />
      <View style={{ position: 'absolute', left: '66%', top: 0, bottom: 0, width: 0.8, backgroundColor: 'rgba(100,66,0,0.45)' }} />
      <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 0.8, backgroundColor: 'rgba(100,66,0,0.45)' }} />
      <View style={{ position: 'absolute', left: '33%', right: '33%', top: '28%', bottom: '28%', borderRadius: 3, borderWidth: 0.8, borderColor: 'rgba(100,66,0,0.45)' }} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -12, bottom: -12, left: 12, width: 14 }, reflejo]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,240,0.85)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

// La etiqueta que flota al sumar o restar puntos, y el destello de la tarjeta.
// Al GANAR (2026-10-14, «momentos con sensación»): el háptico y la animación
// propios del material (componentes/momentos.js) en vez del éxito genérico.
// Al restar se queda el aviso de siempre.
function CambioDeSaldo({ delta, material }) {
  const v = useSharedValue(0);
  const flash = useSharedValue(0);
  const suma = delta > 0;
  useEffect(() => {
    if (suma) vibrarMomento(material);
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
      {suma ? <Momento material={material} radio={22} /> : null}
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
// En reposo (2026-10-14) lee 4 veces por segundo y no mueve nada: sólo mira
// si la volvieron a inclinar para despertarla. Las primeras lecturas se
// saltan: un sensor recién montado arranca en cero y parecería un movimiento.
function Sensor({ salidaX, salidaY, enReposo }) {
  const { x, y } = useInclinacion(enReposo ? 250 : 33);
  const lecturas = useSharedValue(0);
  const refX = useSharedValue(0);
  const refY = useSharedValue(0);
  useAnimatedReaction(() => [x.value, y.value], ([a, b]) => {
    if (!enReposo) { salidaX.value = a; salidaY.value = b; return; }
    lecturas.value += 1;
    if (lecturas.value <= 3) { refX.value = a; refY.value = b; return; }
    if (Math.abs(a - refX.value) + Math.abs(b - refY.value) > 0.09) runOnJS(despertar)();
  }, [enReposo]);
  return null;
}

// La ráfaga de luz al mantenerla presionada: una franja ancha cruza en
// diagonal y el canto se enciende un instante.
function Rafaga({ v }) {
  const franja = useAnimatedStyle(() => ({
    opacity: v.value > 0 && v.value < 1 ? 1 : 0,
    transform: [{ translateX: -260 + v.value * 760 }, { rotate: '22deg' }],
  }));
  const canto = useAnimatedStyle(() => ({ opacity: v.value > 0 && v.value < 1 ? Math.sin(v.value * Math.PI) * 0.9 : 0 }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -80, bottom: -80, left: 0, width: 150 }, franja]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(230,238,255,0.38)', 'rgba(255,255,255,0.62)', 'rgba(255,225,250,0.38)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' }, canto]} />
    </>
  );
}

const estilos = StyleSheet.create({
  cara: { borderRadius: 22, overflow: 'hidden', backfaceVisibility: 'hidden' },
  sombra: { shadowColor: '#2B0B3A', shadowRadius: 22, borderRadius: 22 },
  contenido: { flex: 1, padding: 20, justifyContent: 'space-between' },
  // Sombras de texto marcadas (2026-10-09): sobre metal claro (plata, oro) los
  // textos casi no se distinguían.
  marca: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  socio: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 2.5, textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  chip: { width: 46, height: 34, borderRadius: 7 },
  halo: {
    padding: 6, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  nombre: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 1.5, textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 7, textShadowOffset: { width: 0, height: 1 } },
  desde: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', opacity: 0.92, textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  saldo: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 9, textShadowOffset: { width: 0, height: 1 } },
  puntos: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', opacity: 0.95, textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  qr: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 14 },
  codigo: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
});
