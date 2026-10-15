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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import EfectoNivel from './EfectoNivel';
import Mineral, { MATERIALES } from './minerales/Mineral';
import LogoEnRelieve from './minerales/LogoEnRelieve';
import SelloEquipo from './minerales/SelloEquipo';
import RotuloLamina from './minerales/RotuloLamina';
import { despertar, useDespierta } from './reposo';
import { useMoviendo } from '../lib/desplazamiento';
import { useMoviendoValor } from './movimiento';
import { Momento, vibrarMomento } from './momentos';
import { AccessibilityInfo, Image, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation, Easing, interpolate, runOnJS, useReducedMotion, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import CodigoQR from './CodigoQR';
import CodigoBarras from './CodigoBarras';
import * as Haptics from 'expo-haptics';
import * as Brightness from 'expo-brightness';
import tokens from '@nucleo/constants/tokens.json';
import useInclinacion from './useInclinacion';
import { ANDROID, LIVIANO } from '../lib/rendimiento';
import BrilloTarjeta from './BrilloTarjeta';
import { dolares, entero } from '../lib/formato';
import { NumeroAnimado } from './animacion';
// La foto de perfil se precarga en cuanto llega el resumen (2026-10-14): la
// tarjeta es lo primero que se monta al abrir la app, así que el módulo se
// evalúa al arrancar y Cuenta ya la encuentra en memoria (lib/fotoPerfil.js).
import '../lib/fotoPerfil';

const T = tokens.temas.solid;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const QR_DE = (codigo) => `https://portal.farmasalud.lat/mis-puntos?codigo=${codigo}`;
const GIRO = { damping: 15, stiffness: 110, mass: 1 };
const SUAVE = { damping: 20, stiffness: 90 };
const SOLTAR = { damping: 18, stiffness: 160 };
// Las esquinas de la tarjeta: las de la cara, el filo del canto y la placa.
const RADIO = 22;
// La perspectiva del giro (la misma de `frente` y `reverso`) y el grueso de la
// tarjeta respecto de su ancho: una de verdad mide 0,76 mm sobre 85,6 mm
// (0,9 %); un poco más, para que en la pantalla se lea.
const PERSPECTIVA = 1000;

// El resorte del giro llega en ~0.3 s pero se APAGA mucho después: Reanimated
// lo da por terminado con energía relativa 6e-9, o sea a ~0.008° del final, y
// con este amortiguamiento eso son ~1.3 s (2026-10-15, «al girar se ve borroso,
// pasa 1 segundo y queda nítido»). Todo ese rato el valor es 0.9997 y no 1: la
// cara seguía con perspectiva y giro, iOS la componía en 3D y re-muestreaba el
// texto y el QR. Después del primer rebote el resorte ya no se aleja más de
// 0.3° de la cara, así que a menos de 0.9° se la da por ASENTADA: identidad
// exacta desde ~0.45 s, sin salto que se vea.
const asentado = (g) => {
  'worklet';
  if (Math.abs(g) < 0.005) return 0;
  if (Math.abs(g - 1) < 0.005) return 1;
  return g;
};
const GROSOR = 0.011;
const limitar = (v) => { 'worklet'; return Math.max(-1, Math.min(1, v)); };
// Nitidez (2026-10-14, «que todo en la card se vea ultra nítido»): una capa
// con una transformación 3D, o corrida una fracción de píxel, se dibuja
// re-muestreada —el texto y el QR salen suavizados—. En reposo la tarjeta
// tiene que quedar con la transformación EXACTA de identidad: los giros en 0,
// la escala en 1 y los corrimientos en píxeles enteros.
const DENSIDAD = PixelRatio.get();
const alPixel = (v) => { 'worklet'; return Math.round(v * DENSIDAD) / DENSIDAD; };
// Menos de una décima de grado no se ve, pero obliga a re-muestrear la capa.
const grados = (v) => { 'worklet'; return Math.abs(v) < 0.1 ? 0 : v; };
const vibrar = (fuerte) => Haptics.impactAsync(fuerte ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
// La ráfaga al mantenerla presionada: despierta y dos golpes hápticos. Fuera
// del componente: no depende de nada suyo y los gestos la capturan una vez.
const alRafaga = () => {
  despertar();
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 140);
};

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
// QR o barras en el reverso (2026-10-15): se recuerda la última elección.
const CLAVE_VISTA = 'puntos_salud_tarjeta_vista';
// El código letra por letra: junto, VoiceOver lo leía como una palabra.
const deletrear = (c) => String(c).split('').join(' ');

function TarjetaSocio({ nombre, saldo, equivale, codigo, socioDesde, nivel: nivelDado = 'vip', activa = true, previo = null, cambio = null, equipo = false, estiloLogo = 'material' }) {
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
  // Mientras la pantalla se desplaza (lib/desplazamiento.js, 2026-10-14, «el
  // Inicio se siente lento») el material, la luz que pasa y el giroscopio se
  // quedan quietos donde están: el shader recalculado en el mismo cuadro que
  // el desplazamiento era lo que hacía perder cuadros. Al soltar, siguen.
  // Como VALOR COMPARTIDO (2026-10-15): con el booleano de React la tarjeta
  // entera se repintaba dos veces por cada gesto de desplazamiento. Ahora lo
  // leen los worklets —el reloj del material, el barrido, el giroscopio— y
  // React no se entera.
  const moviendo = useMoviendoValor();
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
  // En reposo (2026-10-14, nitidez) la tarjeta se ASIENTA plana: con el
  // ladeo del giroscopio quieto en unos grados, el nombre, el saldo y el logo
  // quedaban re-muestreados por la perspectiva para siempre. El resorte la
  // lleva a 0 exacto —sin transformación, cada píxel en su sitio— y al
  // despertarla vuelve a seguir al teléfono.
  useEffect(() => {
    if (despierta) return;
    suaveX.value = withSpring(0, SUAVE);
    suaveY.value = withSpring(0, SUAVE);
  }, [despierta, suaveX, suaveY]);
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
  // La franja de luz: al llegar y cada ~6 s, sólo mientras se ve y la
  // pantalla no se desplaza. Se arranca y se para en el hilo de la interfaz
  // (2026-10-15): `moviendo` es un valor compartido, y `vivaUI` la copia de
  // `viva` que el worklet puede leer.
  const vivaUI = useSharedValue(viva);
  useEffect(() => { vivaUI.value = viva; }, [viva, vivaUI]);
  useAnimatedReaction(() => vivaUI.value && !moviendo.value, (ahora, antes) => {
    if (ahora === antes) return;
    cancelAnimation(barrido);
    barrido.value = 0;
    if (!ahora) return;
    barrido.value = withDelay(500, withRepeat(withSequence(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }),
      withDelay(5000, withTiming(0, { duration: 0 })),
    ), -1));
  });

  // El brillo se pide AL TOCAR, no a mitad del giro (2026-10-08): desde la
  // reacción del giro no llegaba siempre, y el QR quedaba con la pantalla oscura.
  // Qué cara se ve, para VoiceOver (2026-10-13): con el reverso a la vista
  // el rótulo tiene que leer el código, no el saldo del frente.
  const [deReves, setDeReves] = useState(false);
  // Los gestos se arman UNA vez (2026-10-15) y llaman a `alVoltear`, estable,
  // que a su vez llama a la última `voltear` — ésta lee `pista` y `codigo`,
  // que cambian.
  const voltearRef = useRef(null);
  const alVoltear = useCallback(() => { voltearRef.current?.(); }, []);
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
  voltearRef.current = voltear;
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
  // Las dos caras tienen sus lienzos MONTADOS siempre (2026-10-14, build 55:
  // «si la toco, giro, se pone la mitad sin los efectos, parpadea y luego se
  // pone bien»). En Android se montaba la otra cara al empezar el giro y se
  // soltaba al terminar: un lienzo de Skia recién montado no tiene superficie
  // ni tamaño durante unos cuadros, así que cada giro mostraba una cara sin
  // material y un parpadeo al llegar. El ahorro de entonces —que la cara de
  // atrás no se redibuje con el giroscopio— se logra ahora sin desmontar:
  // cada cara recibe su PROPIA copia de la inclinación y del barrido, que
  // sólo se actualiza mientras esa cara puede verse. Oculta, sus valores no
  // cambian y su lienzo no tiene nada que redibujar.
  const frenteX = useEspejo(x, giro, true);
  const frenteY = useEspejo(y, giro, true);
  const frenteBarrido = useEspejo(barrido, giro, true);
  const reversoX = useEspejo(x, giro, false);
  const reversoY = useEspejo(y, giro, false);
  const reversoBarrido = useEspejo(barrido, giro, false);
  // El RELOJ del material va con la cara que se ve (2026-10-14, «al darse la
  // vuelta se pierde la fantasía»): el reverso tenía su material con el reloj
  // quieto, así que al girar aparecía una piedra congelada —sin destellos ni
  // brillo que corre— y la magia se cortaba justo a mitad del giro. Ahora cada
  // cara corre mientras puede verse, con el mismo margen que `useEspejo`: la
  // que llega ya está viva antes de asomar, y la que se va se detiene recién
  // pasado el canto, cuando ya no se ve. Quieta, sigue corriendo una sola.
  // bit 1 = frente, bit 2 = reverso.
  const [caras, setCaras] = useState(1);
  useAnimatedReaction(() => (giro.value < 0.6 ? 1 : 0) | (giro.value > 0.4 ? 2 : 0), (ahora, antes) => {
    if (antes !== null && ahora !== antes) runOnJS(setCaras)(ahora);
  });
  const vivaFrente = viva && (caras & 1) !== 0;
  const vivaReverso = viva && (caras & 2) !== 0;
  // El tamaño de la tarjeta, para el canto que se ve al girar (`Canto`).
  const tam = useSharedValue({ w: 0, h: 0 });
  // El ancho en React, para medir el código de barras: lo más ancho que quepa
  // (hasta 300 pt), con el módulo en píxeles enteros. 0 hasta el primer layout.
  const [anchoTarjeta, setAnchoTarjeta] = useState(0);

  // QR o código de BARRAS en el reverso (2026-10-15): los lectores de mano de
  // la sala son de una dimensión y no leen el QR. Los dos no caben juntos sin
  // achicar el QR (118 pt) por debajo de lo que se lee seguro, así que el
  // reverso lleva un selector y recuerda la última elección. Las dos vistas
  // quedan MONTADAS (dibujos estáticos, baratos) y se funden: la que se ve
  // queda con opacidad 1 exacta —sin re-muestreo—.
  const [vista, setVista] = useState('qr');
  const modo = useSharedValue(0); // 0 = QR, 1 = barras
  useEffect(() => {
    SecureStore.getItemAsync(CLAVE_VISTA).then((v) => {
      if (v === 'barras') { setVista('barras'); modo.value = 1; }
    }).catch(() => {});
  }, [modo]);
  const cambiarVista = (nueva) => {
    if (nueva === vista) return;
    despertar();
    Haptics.selectionAsync().catch(() => {});
    setVista(nueva);
    modo.value = reducir ? (nueva === 'barras' ? 1 : 0) : withTiming(nueva === 'barras' ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
    SecureStore.setItemAsync(CLAVE_VISTA, nueva).catch(() => {});
    AccessibilityInfo.announceForAccessibility(nueva === 'barras' ? 'Código de barras' : 'Código QR');
  };
  const capaQr = useAnimatedStyle(() => ({ opacity: 1 - modo.value }));
  const capaBarras = useAnimatedStyle(() => ({ opacity: modo.value }));

  // Mantenerla presionada (2026-10-14): una ráfaga de luz la cruza y el
  // teléfono responde con dos golpes hápticos. Sólo de frente.
  const rafaga = useSharedValue(0);
  // Armados una sola vez (2026-10-15): antes se rehacían en cada render y el
  // detector de gestos se reconfiguraba con cada cambio de la tarjeta. Todo lo
  // que leen son valores compartidos (estables) o funciones estables.
  // `toque` sale aparte: el selector QR/barras lo BLOQUEA (si no, tocar el
  // selector también giraba la tarjeta).
  const { gestos, toque } = useMemo(() => {
    // Arrastrar de lado la inclina; un deslizamiento rápido la gira. Lo
    // vertical se lo deja a la pantalla (que hace scroll).
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
        if (Math.abs(e.velocityX) > 700) runOnJS(alVoltear)();
      });
    const toque = Gesture.Tap().maxDuration(300).onEnd((_e, ok) => { if (ok) runOnJS(alVoltear)(); });
    const largo = Gesture.LongPress().minDuration(420).onStart(() => {
      if (giro.value > 0.5) return;
      rafaga.value = 0;
      rafaga.value = withTiming(1, { duration: 950, easing: Easing.out(Easing.cubic) });
      runOnJS(alRafaga)();
    });
    return { gestos: Gesture.Race(arrastre, largo, toque), toque };
  }, [dedoX, dedoY, giro, rafaga, alVoltear]);
  // Profundidad (Platino): el contenido flota sobre el material y el logo un
  // poco más; al inclinar, cada capa se corre distinto — paralaje.
  // Corridos a píxel entero (2026-10-14): a una fracción de píxel el texto se
  // dibuja entre dos píxeles y se ve suave. El paso de 1/3 pt no se nota.
  // Con la copia del FRENTE (2026-10-15): con el QR a la vista estas capas no
  // se ven, y con la inclinación cruda se recalculaban con el giroscopio igual.
  const capaTexto = useAnimatedStyle(() => (exclusiva ? { transform: [{ translateX: alPixel(-frenteX.value * 3) }, { translateY: alPixel(frenteY.value * 2) }] } : {}));
  const capaLogo = useAnimatedStyle(() => (exclusiva ? { transform: [{ translateX: alPixel(-frenteX.value * 6) }, { translateY: alPixel(frenteY.value * 4) }] } : {}));

  const ladeo = useAnimatedStyle(() => {
    // 0 en las caras, 1 a mitad del giro. En 0 o 1 exactos, 0 exacto: sin(π)
    // no da 0 en coma flotante.
    const g = asentado(giro.value);
    const medio = g === 0 || g === 1 ? 0 : Math.sin(g * Math.PI);
    // Con el QR a la vista la tarjeta queda PLANA (2026-10-14, «el código sale
    // pixeleado»): ladeada, el código se re-muestrea por la perspectiva y
    // pierde los bordes netos que el lector necesita. El ladeo se apaga con el
    // giro; el brillo del reverso sigue a la inclinación igual.
    const plano = 1 - Math.max(0, Math.min(1, g));
    const rx = grados(-y.value * 12 * plano);
    const ry = grados(x.value * 14 * plano);
    // Sin levantarla al girar: subía 10 pt y tapaba lo de arriba (la campana).
    const ty = alPixel((1 - entrada.value) * 16);
    const esc = (0.97 + entrada.value * 0.03) * (1 - medio * 0.06);
    // Quieta y plana: identidad EXACTA, sin perspectiva — iOS no tiene que
    // componer la tarjeta en 3D y el texto y el QR salen píxel a píxel.
    if (rx === 0 && ry === 0 && ty === 0 && Math.abs(esc - 1) < 1e-4) {
      return { opacity: entrada.value, transform: [{ translateY: 0 }] };
    }
    return {
      opacity: entrada.value,
      transform: [
        { perspective: 1000 },
        { translateY: ty },
        { rotateX: `${rx}deg` },
        { rotateY: `${ry}deg` },
        { scale: esc },
      ],
    };
  });
  // La sombra que se corre: en Android las `shadow*` no existen (allá es
  // `elevation`, que no sigue la inclinación), así que ni se calcula — era un
  // estilo animado recalculado en cada cuadro para nada (2026-10-13).
  const sombra = useAnimatedStyle(() => (ANDROID ? {} : {
    shadowOffset: { width: -x.value * 14, height: 14 + y.value * 8 },
    shadowOpacity: 0.28 + Math.abs(x.value) * 0.12,
    // La placa se apaga en los primeros grados del giro: de canto, la cara ya
    // no la tapa (y una tarjeta de canto casi no da sombra).
    // Con el VALOR ABSOLUTO (2026-10-14, «al darse la vuelta se ven los
    // bordes»): sin él, el seno es NEGATIVO cuando el resorte se pasa de 1
    // (al llegar al reverso) o de 0 (al volver al frente), y la placa quedaba
    // a opacidad plena justo con la cara ladeada unos grados por el rebote —
    // asomaba por el lado que se aleja como un filo liso del color de la placa.
    opacity: Math.max(0, 1 - Math.abs(Math.sin(asentado(giro.value) * Math.PI)) * 5),
  }));
  // La cara que se ve, en reposo, sin perspectiva ni giro (2026-10-14,
  // nitidez): `rotateY(360deg)` con perspectiva es «casi» la identidad y
  // obligaba a componer el reverso —el QR— en 3D.
  const frente = useAnimatedStyle(() => {
    const g = asentado(giro.value);
    return g === 0
      ? { transform: [{ rotateY: '0deg' }] }
      : { transform: [{ perspective: PERSPECTIVA }, { rotateY: `${interpolate(g, [0, 1], [0, 180])}deg` }] };
  });
  const reverso = useAnimatedStyle(() => {
    const g = asentado(giro.value);
    return g === 1
      ? { transform: [{ rotateY: '0deg' }] }
      : { transform: [{ perspective: PERSPECTIVA }, { rotateY: `${interpolate(g, [0, 1], [180, 360])}deg` }] };
  });

  // Primer nombre + primer apellido, la regla del portal (`shortEmployeeName`):
  // con 4 palabras el apellido es la tercera; con 3, la segunda.
  const p = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
  const nombreTarjeta = p.length >= 4 ? `${p[0]} ${p[2]}` : p.length === 3 ? `${p[0]} ${p[1]}` : p.join(' ');

  return (
    <>
    {activa && !reducir ? <Sensor key={despierta ? 'viva' : 'reposo'} salidaX={sx} salidaY={sy} enReposo={!despierta} pausa={moviendo} /> : null}
    <GestureDetector gesture={gestos}>
      <Animated.View style={[{ aspectRatio: 1.586, width: '100%' }, ladeo]}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          tam.value = { w, h };
          const wr = Math.round(w);
          setAnchoTarjeta((a) => (a === wr ? a : wr));
        }}
        accessible accessibilityRole="button"
        // La tarjeta es UN elemento para VoiceOver, así que el selector QR/barras
        // no se alcanza adentro: va como acción de la tarjeta.
        accessibilityActions={deReves ? [{ name: 'cambiarCodigo', label: vista === 'qr' ? 'Mostrar código de barras' : 'Mostrar código QR' }] : []}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'cambiarCodigo') cambiarVista(vista === 'qr' ? 'barras' : 'qr'); }}
        accessibilityLabel={deReves
          ? `Tu código: ${codigo ? deletrear(codigo) : 'sin código'}. Muéstralo en caja para usar tus puntos.`
          : `Tu tarjeta ${paleta.rotulo.toLowerCase()}${equipo ? ', del Team Farmacia Salud' : ''}. Saldo ${dolares(equivale)}. Toca para ver tu código.`}
        accessibilityHint={deReves ? 'Gira la tarjeta al frente' : 'Gira la tarjeta'} onAccessibilityTap={voltear}>
        {/* La sombra, en su propia placa OPACA (iPhone, 2026-10-14): una sombra
            sobre una vista transparente se calcula píxel a píxel con todo lo
            que tiene adentro —los lienzos de Skia incluidos— en cada cuadro,
            también mientras se desplaza la pantalla. Con fondo sólido, React
            Native le da el contorno redondeado (`shadowPath`) y la sombra sale
            casi gratis. La placa queda tapada por la cara; al girar se apaga
            antes de asomar por el canto. */}
        {/* (2026-10-14) La placa va METIDA unos puntos de cada lado: el borde
            suavizado de la cara redondeada dejaba ver su color como un filo
            oscuro alrededor de la tarjeta, y con la cara ladeada —el rebote del
            giro, la perspectiva— asomaba por el lado que se aleja. Metida, la
            cara la tapa entera hasta pasados los 15°, donde ya se apagó; la
            sombra, con su desenfoque de 22, se ve igual. */}
        {ANDROID ? null : <Animated.View pointerEvents="none" style={[estilos.placa, estilos.sombra, { backgroundColor: paleta.sombra, shadowColor: paleta.sombra }, sombra]} />}
        {/* Las dos caras, dentro de su PROPIA capa (2026-10-14, build 55: «la
            mitad sin los efectos, parpadea y luego se pone bien»). Core
            Animation ordena por PROFUNDIDAD a las capas hermanas que tienen
            transformación 3D: con las caras como hermanas directas de la placa
            de la sombra, cada cara que gira —o que rebota en el resorte al
            llegar— dejaba media tarjeta DETRÁS del plano de la placa, y esa
            mitad se veía del color liso de la placa, sin material; con la cara
            justo en el plano, las dos se peleaban cuadro a cuadro (parpadeo).
            Una capa intermedia aplana el giro de las caras en su plano, y la
            placa queda simplemente debajo, en el orden en que se dibujan.
            `collapsable={false}`: que la nueva arquitectura no la quite por ser
            sólo de diseño. */}
        <View style={StyleSheet.absoluteFill} collapsable={false} pointerEvents="box-none">
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
          {MATERIALES.includes(nivel) ? <Mineral key={nivel} material={nivel} x={frenteX} y={frenteY} activa={vivaFrente} pausa={moviendo} />
            : <EfectoPausable nivel={nivel} activa={vivaFrente} x={frenteX} />}
          {/* Una sombra suave abajo: el nombre y el saldo se leen sobre cualquier material. */}
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.30)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.50)']}
            locations={[0, 0.28, 0.55, 1]} style={StyleSheet.absoluteFill} />
          <BrilloTarjeta x={frenteX} y={frenteY} barrido={frenteBarrido} sinArcoiris={MATERIALES.includes(nivel)} aro={paleta.acento} giro={giro} esquina={RADIO} />

          {/* El logo al centro: llena el espacio entre el chip y el nombre
              (pedido del usuario, 2026-10-06), con un halo suave. */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, capaLogo]}>
            <LogoEnRelieve tam={84} x={frenteX} y={frenteY} estilo={estiloLogo} />
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
                  ? <RotuloLamina texto={paleta.rotulo} tam={15} espacio={3} x={frenteX} y={frenteY} estiloRespaldo={estilos.socio} />
                  : <Text maxFontSizeMultiplier={1.3} style={estilos.socio}>{paleta.rotulo}</Text>}
              </View>
            </View>

            {/* El «chip», como en una tarjeta de verdad; al personal, a su lado
                derecho, el sello holográfico de PERSONAL (2026-10-08). */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <ChipOro x={frenteX} />
              {equipo ? <SelloEquipo x={frenteX} y={frenteY} activa={vivaFrente} pausa={moviendo} /> : null}
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
          <Rafaga v={rafaga} />
        </Animated.View>

        {/* ── Reverso: el código ── */}
        <Animated.View style={[StyleSheet.absoluteFill, estilos.cara, reverso]}>
          <LinearGradient colors={paleta.reverso} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {/* El mismo material del frente, más oscuro para que el código se lea.
              Vivo mientras el reverso puede verse (`caras`); de frente, quieto. */}
          {MATERIALES.includes(nivel) ? <Mineral key={nivel} material={nivel} x={reversoX} y={reversoY} activa={vivaReverso} pausa={moviendo} />
            : <EfectoPausable nivel={nivel} activa={vivaReverso} x={reversoX} />}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.42)' }]} />
          <BrilloTarjeta x={reversoX} y={reversoY} barrido={reversoBarrido} sinArcoiris={MATERIALES.includes(nivel)} aro={paleta.acento} giro={giro} esquina={RADIO} />
          {/* El QR: para la cámara de un teléfono (abre «Mis puntos»). */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, capaQr]}>
            <View style={[estilos.contenido, { flexDirection: 'row', alignItems: 'center', gap: 18 }]}>
              <View style={estilos.qr}>
                {/* Módulos de píxeles enteros (componentes/CodigoQR.js): nítido a 3×. */}
                {codigo ? <CodigoQR value={QR_DE(codigo)} size={118} color="#1A0822" backgroundColor="#FFFFFF" /> : null}
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text maxFontSizeMultiplier={1.3} style={estilos.socio}>TU CÓDIGO</Text>
                <Text maxFontSizeMultiplier={1.3} style={estilos.codigo} adjustsFontSizeToFit numberOfLines={1}>{codigo ?? '—'}</Text>
                <Text maxFontSizeMultiplier={1.3} style={estilos.ayuda}>Muéstralo en caja para usar tus puntos.</Text>
              </View>
            </View>
          </Animated.View>
          {/* Las barras: para el lector de mano de la caja. El código PELADO
              (sin la dirección del QR), que es lo que el lector «teclea».
              Placa blanca de borde a borde del dibujo: la zona de silencio de
              10 módulos va adentro del código, en blanco. Barras negras puras:
              el láser rojo necesita el mayor contraste posible. */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, capaBarras]}>
            <View style={[estilos.contenido, { alignItems: 'center' }]}>
              <Text maxFontSizeMultiplier={1.2} style={[estilos.socio, { alignSelf: 'flex-start' }]}>TU CÓDIGO</Text>
              {codigo && anchoTarjeta > 0 ? (
                <View style={estilos.placaBarras}>
                  <CodigoBarras value={codigo} ancho={Math.min(300, anchoTarjeta - 32)}
                    alto={Math.max(48, Math.min(64, Math.floor(anchoTarjeta / 1.586) - 140))} />
                  <Text maxFontSizeMultiplier={1.2} style={estilos.codigoBarras}>{codigo}</Text>
                </View>
              ) : null}
              <Text maxFontSizeMultiplier={1.2} style={[estilos.ayuda, { fontSize: 12, lineHeight: 16 }]}>Muéstralo en caja para usar tus puntos.</Text>
            </View>
          </Animated.View>
          {/* El selector, arriba a la derecha en las dos vistas. Sólo responde
              con el reverso a la vista: de frente, el reverso girado queda
              debajo del dedo y un toque «a ciegas» cambiaría la vista. */}
          <View pointerEvents={deReves ? 'box-none' : 'none'} style={estilos.selectorCaja}>
            <SelectorCodigo vista={vista} activo={deReves} bloquea={toque} alCambiar={cambiarVista} />
          </View>
        </Animated.View>
        </View>
        {/* El grueso de la tarjeta, visto de canto al girar (ver `Canto`). */}
        <Canto giro={giro} tam={tam} paleta={paleta} />

        {cambio ? <CambioDeSaldo key={cambio.id} delta={cambio.delta} material={nivel} /> : null}
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

// El selector QR · BARRAS del reverso (2026-10-15): una píldora de vidrio
// oscuro con el segmento elegido en blanco, del tamaño de los rótulos de la
// tarjeta. Cada segmento es su propio toque y BLOQUEA el toque de la tarjeta
// (`bloquea`): sin eso, elegir «Barras» también la giraba al frente.
function SelectorCodigo({ vista, activo, bloquea, alCambiar }) {
  return (
    <View style={estilos.selector}>
      {[['qr', 'QR'], ['barras', 'BARRAS']].map(([clave, rotulo]) => (
        <Segmento key={clave} rotulo={rotulo} elegido={vista === clave} activo={activo} bloquea={bloquea}
          alTocar={() => alCambiar(clave)} />
      ))}
    </View>
  );
}

function Segmento({ rotulo, elegido, activo, bloquea, alTocar }) {
  // La función cambia en cada render; el gesto llama a la última.
  const ultima = useRef(alTocar);
  ultima.current = alTocar;
  const llamar = useCallback(() => { ultima.current?.(); }, []);
  const gesto = useMemo(() => Gesture.Tap().enabled(activo).maxDuration(400)
    .hitSlop({ top: 12, bottom: 12, left: 4, right: 4 })
    .blocksExternalGesture(bloquea)
    .onEnd((_e, ok) => { if (ok) runOnJS(llamar)(); }), [activo, bloquea, llamar]);
  return (
    <GestureDetector gesture={gesto}>
      <View style={[estilos.segmento, elegido && estilos.segmentoElegido]}>
        <Text maxFontSizeMultiplier={1.2} style={[estilos.segmentoTexto, elegido && { color: '#1A0822' }]}>{rotulo}</Text>
      </View>
    </GestureDetector>
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

// El CANTO de la tarjeta (2026-10-14, «que nunca se pierda la fantasía»): las
// caras son planos sin grueso, así que a mitad del giro la tarjeta se volvía
// NADA —ninguna cara se ve de canto— y al ladearse mostraba sólo un recorte.
// Una tarjeta de verdad, al girar, enseña su borde: una franja finísima de
// metal que se enciende cuando mira a la luz.
//
// Se calcula como geometría y no como una tercera cara 3D: el lado de la
// placa (x = ±ancho/2, z entre 0 y −grueso, detrás de la cara que se ve) se
// proyecta con la MISMA perspectiva que las caras (`x·p/(p − z)`) y se dibuja
// como una franja PLANA justo afuera del borde proyectado. Así no se pelea en
// profundidad con las caras (iOS ordena por z a las capas 3D hermanas; Android
// no ordena nada) ni depende de cómo cada sistema descompone una matriz con
// dos giros: en los dos se ve igual. La franja nunca pisa la cara: va del filo
// hacia afuera.
function Canto({ giro, tam, paleta }) {
  const franja = useAnimatedStyle(() => {
    const { w, h } = tam.value;
    const th = giro.value * Math.PI;
    const s = Math.sin(th);
    const c = Math.cos(th);
    if (!w || !h || Math.abs(s) < 0.02) return { opacity: 0, transform: [{ scaleX: 0 }] };
    const grosor = Math.max(3, w * GROSOR);
    // Rotación en Y (la de Core Animation y la de CSS): x' = x·cos + z·sen,
    // z' = −x·sen + z·cos. Con sen > 0 se acerca el lado IZQUIERDO, y ése es
    // el canto que mira a quien ve; con sen < 0 (el rebote), el derecho.
    const lado = s > 0 ? -1 : 1;
    // El cuerpo de la tarjeta queda DETRÁS de la cara visible: z ≤ 0 mientras
    // se ve el frente (cos > 0) y z ≥ 0 cuando ya se ve el reverso.
    const z1 = c >= 0 ? -grosor : grosor;
    const P = PERSPECTIVA;
    const xa = lado * (w / 2) * c;
    const za = -lado * (w / 2) * s;
    const ka = P / (P - za);
    const xb = lado * (w / 2) * c + z1 * s;
    const zb = -lado * (w / 2) * s + z1 * c;
    const kb = P / (P - zb);
    const pa = xa * ka;
    const pb = xb * kb;
    const ancho = Math.max(0.6, Math.abs(pb - pa));
    const centro = w / 2 + (pa + pb) / 2;
    const k = (ka + kb) / 2;
    return {
      opacity: Math.min(1, Math.abs(s) * 6),
      // La franja base mide 1 pt de ancho y el alto de la tarjeta; se lleva al
      // centro del canto proyectado y se estira a su ancho. El alto, el del
      // borde recto (sin las esquinas redondeadas), con la perspectiva del lado.
      transform: [{ translateX: centro - 0.5 }, { scaleX: ancho }, { scaleY: k * (1 - (1.4 * RADIO) / h) }],
    };
  });
  // El brillo: más fuerte cuanto más mira el canto a quien ve (de canto pleno, a 90°).
  const luz = useAnimatedStyle(() => ({ opacity: Math.pow(Math.abs(Math.sin(giro.value * Math.PI)), 2) * 0.75 }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1 }, franja]}>
      <LinearGradient colors={[`${paleta.acento}00`, paleta.frente[1], paleta.acento, paleta.frente[0], paleta.sombra, `${paleta.sombra}00`]}
        locations={[0, 0.08, 0.35, 0.65, 0.92, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, luz]}>
        <LinearGradient colors={['#FFFFFF00', '#FFFFFFE6', '#FFFFFF59', '#FFFFFF00']} locations={[0.05, 0.3, 0.6, 0.95]}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
}

// Una copia de `fuente` para UNA cara de la tarjeta: sigue a la fuente sólo
// mientras esa cara puede verse (el frente hasta poco después de la mitad del
// giro, el reverso desde poco antes) y, oculta, se queda quieta — así su
// lienzo no se redibuja para nadie, sin desmontarlo. El margen alrededor de la
// mitad cubre el rebote del resorte; de canto ninguna cara se ve.
function useEspejo(fuente, giro, deFrente) {
  const copia = useSharedValue(0);
  useAnimatedReaction(
    () => ((deFrente ? giro.value < 0.6 : giro.value > 0.4) ? fuente.value : null),
    (v) => { if (v !== null && v !== copia.value) copia.value = v; },
  );
  return copia;
}

// El giroscopio, montado sólo mientras la tarjeta se ve: al desmontarse, el
// sensor se suelta y deja de leer.
// En reposo (2026-10-14) lee 4 veces por segundo y no mueve nada: sólo mira
// si la volvieron a inclinar para despertarla. Las primeras lecturas se
// saltan: un sensor recién montado arranca en cero y parecería un movimiento.
// `pausa` (valor compartido: la pantalla se está desplazando): no mueve nada
// ni despierta —al desplazar, el teléfono se inclina—; la tarjeta queda como
// estaba. Se lee en el worklet: cambiarlo no repinta ni remonta el sensor.
function Sensor({ salidaX, salidaY, enReposo, pausa }) {
  const { x, y } = useInclinacion(enReposo ? 250 : 33);
  const lecturas = useSharedValue(0);
  const refX = useSharedValue(0);
  const refY = useSharedValue(0);
  useAnimatedReaction(() => [x.value, y.value], ([a, b]) => {
    if (pausa.value) return;
    lecturas.value += 1;
    if (!enReposo) {
      // Recién montado, el sensor arranca en cero: la tarjeta se iba plana y
      // volvía al volver a la vista. Las dos primeras lecturas no cuentan.
      if (lecturas.value <= 2) return;
      salidaX.value = a; salidaY.value = b; return;
    }
    if (lecturas.value <= 3) { refX.value = a; refY.value = b; return; }
    if (Math.abs(a - refX.value) + Math.abs(b - refY.value) > 0.09) runOnJS(despertar)();
  }, [enReposo]);
  return null;
}

// El acabado sin shader (`EfectoNivel`, para un nivel que no tenga material):
// sus destellos van por React, así que éste sí escucha el desplazamiento como
// booleano — y lo que se repinta es sólo él, no la tarjeta.
function EfectoPausable({ nivel, activa, x }) {
  const moviendo = useMoviendo();
  return <EfectoNivel nivel={nivel} activa={activa && !moviendo} x={x} />;
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
  cara: { borderRadius: RADIO, overflow: 'hidden', backfaceVisibility: 'hidden' },
  placa: { position: 'absolute', top: '3%', bottom: '3%', left: '4%', right: '4%' },
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
  // Sin relleno a los lados: la zona de silencio ya va blanca dentro del dibujo.
  placaBarras: { backgroundColor: '#FFFFFF', borderRadius: 12, overflow: 'hidden', alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  codigoBarras: { color: '#1A0822', fontSize: 13, fontWeight: '800', letterSpacing: 5, marginTop: 4, fontVariant: ['tabular-nums'] },
  selectorCaja: { position: 'absolute', top: 14, right: 14 },
  selector: { flexDirection: 'row', padding: 2, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.38)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  segmento: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  segmentoElegido: { backgroundColor: '#FFFFFF' },
  segmentoTexto: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  codigo: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
});

// Memorizada (2026-10-15): la pantalla que la contiene se repinta por muchas
// cosas (avisos, el resumen que llega, el refresco) y la tarjeta —dos
// lienzos de material, dos de luz y el logo— sólo tiene que rehacerse cuando
// cambian SUS datos.
export default memo(TarjetaSocio);
