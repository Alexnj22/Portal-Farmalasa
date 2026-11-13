// La burbuja del chat con clientes, NATIVA — la `BurbujaChat` del portal
// («estilo Messenger»), con el número de mensajes de clientes que esperan
// respuesta EN VIVO (`useSinLeerDelChat`, el mismo cálculo que el portal).
// Tocarla abre la bandeja del chat.
//
// Lo que pidió el usuario (2026-11-12), en orden:
//   · En TODAS las vistas (no sale en el chat mismo, antes de entrar, ni con
//     el teclado abierto).
//   · Siempre en su LUGAR: abajo a la derecha. Se desliza en vertical, un
//     tramo corto, para destapar un dato o un botón; a los pocos segundos, o
//     al cambiar de pantalla, VUELVE sola a su lugar con un resorte.
//   · Que se note que es el chat: tamaño completo, el ícono del chat y, con
//     mensajes esperando, se ESTIRA mostrando «N sin responder» unos segundos
//     (también al cambiar de pantalla) y late; después queda el número.
//   · Fluida y animada: entra con un resorte, se encoge al tocarla, sigue el
//     dedo con un poco de resistencia en los topes. Todo con el driver nativo
//     (salvo el ancho del rótulo, que no puede).
//   · Deja aire sobre la barra de abajo.
//
// Sólo para quien puede ver el chat (`chat_clientes`). En iPhone es Liquid
// Glass teñido de la marca; en Android, el FAB de Material con la paleta del
// sistema.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, PanResponder, Platform, Text, View, useWindowDimensions } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import { router, usePathname, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useSinLeerDelChat } from '@nucleo/hooks/useSinLeerDelChat';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';
import IconoFijo from '../IconoFijo';
import { useBuscadorAbajo, usePaleta } from '../../tema/material';

const ANDROID = Platform.OS === 'android';
const TAMANO = 54;
const MARGEN = 16;
// Alto de la barra de pestañas encima del área segura (la flotante de iOS 26
// y la de Material) más aire.
const ALTO_PESTANAS = (ANDROID ? 80 : 64) + 14;
// iOS 26: el buscador de la barra va abajo (≈ 48 de alto + su margen); con
// él en pantalla, la burbuja se pone encima en vez de taparlo.
const ALTO_BUSCADOR = 62;
// Cuánto puede subir sobre su lugar.
const RECORRIDO = 220;
// Cuánto se queda donde la dejaron antes de volver.
const VUELVE_EN = 3500;
// Cuánto se ve el rótulo «N sin responder».
const ROTULO_MS = 3500;
const ROTULO_ANCHO = 128;

function Numero({ n, visible }) {
  if (!n || !visible) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5,
      alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.rojo, borderWidth: 2, borderColor: '#fff' }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

function BurbujaFlotante() {
  const { user, hasPermission } = useAuth();
  const paleta = usePaleta();
  const segmentos = useSegments();
  const ruta = usePathname();
  const { bottom } = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const puede = !!user && !!hasPermission?.('chat_clientes', 'can_view');
  const { sinLeer, late } = useSinLeerDelChat({ activo: puede });
  const [teclado, setTeclado] = useState(false);
  const [rotulo, setRotulo] = useState(false);

  const enPestanas = segmentos[0] === '(tabs)';
  const enElChat = segmentos.some((s) => String(s).startsWith('chat-clientes'));
  const visible = puede && !teclado && !enElChat && segmentos[0] !== 'entrar';
  const conBuscador = useBuscadorAbajo((s) => Object.keys(s.claves).length > 0);
  const abajo = bottom + (enPestanas ? ALTO_PESTANAS : MARGEN) + (conBuscador ? ALTO_BUSCADOR : 0);

  // Valores animados: desplazamiento vertical (0 = su lugar, negativo = más
  // arriba), entrada, latido, apretado — nativos. El ancho del rótulo, JS.
  const dy = useRef(new Animated.Value(0)).current;
  const entrada = useRef(new Animated.Value(0)).current;
  const latido = useRef(new Animated.Value(1)).current;
  const apretado = useRef(new Animated.Value(1)).current;
  const ancho = useRef(new Animated.Value(0)).current;
  const volver = useRef(null);

  const aSuLugar = () => {
    clearTimeout(volver.current);
    Animated.spring(dy, { toValue: 0, useNativeDriver: true, stiffness: 220, damping: 20, mass: 0.9 }).start();
  };

  // Entra con resorte cada vez que aparece; sale encogiéndose.
  useEffect(() => {
    Animated.spring(entrada, { toValue: visible ? 1 : 0, useNativeDriver: true, speed: 12, bounciness: visible ? 12 : 0 }).start();
  }, [visible, entrada]);

  // Al cambiar de pantalla: vuelve a su lugar y, si hay mensajes, muestra el rótulo.
  useEffect(() => {
    aSuLugar();
    if (sinLeer > 0) setRotulo(true);
  }, [ruta]); // eslint-disable-line react-hooks/exhaustive-deps

  // El rótulo, cuando sube el número.
  useEffect(() => { if (late) setRotulo(true); }, [late]);
  useEffect(() => { if (!sinLeer) setRotulo(false); }, [sinLeer]);

  useEffect(() => {
    Animated.timing(ancho, { toValue: rotulo ? ROTULO_ANCHO : 0, duration: rotulo ? 320 : 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    if (!rotulo) return undefined;
    const t = setTimeout(() => setRotulo(false), ROTULO_MS);
    return () => clearTimeout(t);
  }, [rotulo, ancho]);

  // El latido: tres pulsos cuando el número sube.
  useEffect(() => {
    if (!late) return undefined;
    const pulso = Animated.sequence([
      Animated.timing(latido, { toValue: 1.16, duration: 170, useNativeDriver: true }),
      Animated.spring(latido, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }),
    ]);
    const anim = Animated.loop(pulso, { iterations: 3 });
    anim.start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return () => anim.stop();
  }, [late, latido]);

  useEffect(() => {
    const a = Keyboard.addListener(ANDROID ? 'keyboardDidShow' : 'keyboardWillShow', () => setTeclado(true));
    const b = Keyboard.addListener(ANDROID ? 'keyboardDidHide' : 'keyboardWillHide', () => setTeclado(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  useEffect(() => () => clearTimeout(volver.current), []);

  // Sigue al dedo en vertical; pasado el tope, con resistencia. Para que no
  // se sienta trabada (usuario, 2026-11-13):
  //   · la posición actual se lleva sincrónica (`actual`), no con el callback
  //     de `stopAnimation`, que llega tarde y hacía saltar el primer tramo;
  //   · se toma el gesto en la fase de CAPTURA y no se suelta: la lista de
  //     atrás ya no se lo roba a mitad de camino;
  //   · al soltar sigue la inercia del dedo (proyecta con la velocidad) y
  //     asienta con un resorte por rigidez, que no rebota de más;
  //   · al tomarla se agranda un poco: se nota que está «en la mano».
  const tope = Math.min(RECORRIDO, Math.max(0, H - abajo - TAMANO - 140));
  const topeRef = useRef(tope);
  topeRef.current = tope;
  const actual = useRef(0);
  useEffect(() => {
    const id = dy.addListener(({ value }) => { actual.current = value; });
    return () => dy.removeListener(id);
  }, [dy]);
  const base = useRef(0);
  const arrastre = useMemo(() => {
    const quiere = (_, g) => Math.abs(g.dy) > 3 && Math.abs(g.dy) > Math.abs(g.dx);
    return PanResponder.create({
      onMoveShouldSetPanResponder: quiere,
      onMoveShouldSetPanResponderCapture: quiere,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        clearTimeout(volver.current);
        dy.stopAnimation();
        base.current = actual.current;
        Animated.spring(apretado, { toValue: 1.08, useNativeDriver: true, stiffness: 420, damping: 26 }).start();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      },
      onPanResponderMove: (_, g) => {
        const t = topeRef.current;
        let v = base.current + g.dy;
        if (v > 0) v = v * 0.3;                         // abajo de su lugar: resistencia
        if (v < -t) v = -t + (v + t) * 0.3;             // arriba del tope: resistencia
        dy.setValue(v);
      },
      onPanResponderRelease: (_, g) => {
        const t = topeRef.current;
        const destino = Math.max(-t, Math.min(0, base.current + g.dy + g.vy * 140));
        Animated.spring(apretado, { toValue: 1, useNativeDriver: true, stiffness: 320, damping: 18 }).start();
        Animated.spring(dy, { toValue: destino, velocity: g.vy, useNativeDriver: true, stiffness: 240, damping: 24, mass: 0.9 }).start();
        clearTimeout(volver.current);
        if (destino < 0) volver.current = setTimeout(aSuLugar, VUELVE_EN);
      },
      onPanResponderTerminate: () => {
        Animated.spring(apretado, { toValue: 1, useNativeDriver: true, stiffness: 320, damping: 18 }).start();
        aSuLugar();
      },
    });
  }, [dy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!puede) return null;

  const etiqueta = sinLeer > 0
    ? `Chat con clientes: ${sinLeer} ${sinLeer === 1 ? 'mensaje' : 'mensajes'} sin responder`
    : 'Chat con clientes';
  const abrir = () => { Haptics.selectionAsync().catch(() => {}); router.push('/chat-clientes'); };
  const tinta = ANDROID && paleta ? paleta.onPrimaryContainer : '#FFFFFF';
  const icono = <IconoFijo name={iconoDe('MessageCircle')} size={26} color={tinta} />;
  const textoRotulo = `${sinLeer > 99 ? '99+' : sinLeer} sin responder`;

  const contenido = (
    <View style={{ height: TAMANO, flexDirection: 'row', alignItems: 'center' }}>
      <Animated.View style={{ width: ancho, overflow: 'hidden', alignItems: 'flex-end' }}>
        <Text numberOfLines={1} style={{ width: ROTULO_ANCHO, paddingLeft: 16, color: tinta, fontSize: 14, fontWeight: '700' }}>{textoRotulo}</Text>
      </Animated.View>
      <View style={{ width: TAMANO, height: TAMANO, alignItems: 'center', justifyContent: 'center' }}>{icono}</View>
    </View>
  );

  return (
    <Animated.View {...arrastre.panHandlers} pointerEvents={visible ? 'auto' : 'none'}
      // Sin `opacity` animada en iOS: el Liquid Glass no se dibuja si un
      // contenedor le anima la opacidad (la burbuja quedaba invisible).
      style={{ position: 'absolute', right: MARGEN, bottom: abajo, ...(ANDROID ? { opacity: entrada } : {}),
        // iOS tampoco puede nacer con escala 0 (el vidrio no se arma): ahí
        // entra subiendo desde abajo, y al ocultarse baja hasta salir de la
        // pantalla (con 140 fijo, encima del buscador se quedaba asomando).
        transform: ANDROID
          ? [{ translateY: dy }, { scale: Animated.multiply(Animated.multiply(entrada, latido), apretado) }]
          : [{ translateY: Animated.add(dy, entrada.interpolate({ inputRange: [0, 1], outputRange: [abajo + TAMANO + 40, 0] })) }, { scale: Animated.multiply(latido, apretado) }] }}>
      <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={etiqueta} accessibilityHint="Desliza arriba o abajo para moverla"
        onPressIn={() => Animated.spring(apretado, { toValue: 0.9, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
        onPressOut={() => Animated.spring(apretado, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }).start()}
        android_ripple={ANDROID ? { color: 'rgba(127,127,127,0.24)', borderless: false, foreground: true } : undefined}
        style={ANDROID ? { borderRadius: 18, overflow: 'hidden', elevation: 6, backgroundColor: paleta?.primaryContainer ?? MARCA.azul } : undefined}>
        {ANDROID ? contenido : (
          <Vidrio radio={TAMANO / 2} interactivo tinte="rgba(0,82,204,0.88)">{contenido}</Vidrio>
        )}
      </Pressable>
      <Numero n={sinLeer} visible={!rotulo} />
    </Animated.View>
  );
}

export default memo(BurbujaFlotante);
