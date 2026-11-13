// La burbuja del chat con clientes, NATIVA — la `BurbujaChat` del portal
// («estilo Messenger»), con el número de mensajes de clientes que esperan
// respuesta EN VIVO (`useSinLeerDelChat`, el mismo cálculo que el portal), que
// late cuando ese número sube. Tocarla abre la bandeja del chat.
//
// (2026-11-12, usuario: «¿por qué no se ve en todas las vistas? si un cliente
// escribe no me doy cuenta… que no interfiera con los datos, pudiéndolo mover
// un poco, o que sea más pequeño»):
//   · Está en TODAS las vistas, no sólo en las pestañas. No aparece en el chat
//     mismo, antes de entrar, ni con el teclado abierto.
//   · Siempre a la DERECHA. Se desliza sólo en vertical y en un tramo corto
//     (hasta RECORRIDO pt sobre su lugar): lo justo para destapar un dato o
//     un botón que quedó detrás (usuario: «arrastrar no me refería a toda la
//     pantalla, sólo en un espacio»). Recuerda la altura en el teléfono.
//   · Sin mensajes esperando se ACHICA y se aclara; cuando llega uno vuelve a
//     su tamaño, late y muestra el número. (Medio escondida fuera del borde
//     se probó y no sirve: arrastrarla desde ahí dispara el gesto de «atrás»
//     del sistema, en Android a la derecha y en iOS a la izquierda.)
//   · Es más chica (48) y deja aire sobre la barra de abajo (antes quedaba
//     pegada en Android).
//
// Sólo para quien puede ver el chat (`chat_clientes`). En iPhone es Liquid
// Glass teñido de la marca; en Android, el FAB de Material con la paleta del
// sistema.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, PanResponder, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useSinLeerDelChat } from '@nucleo/hooks/useSinLeerDelChat';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';
import IconoFijo from '../IconoFijo';
import { usePaleta } from '../../tema/material';
import { guardar, leer } from '../../plataforma/almacen';

const ANDROID = Platform.OS === 'android';
const TAMANO = 48;
const MARGEN = 12;
// Tamaño relativo sin mensajes esperando.
const CHICA = 0.8;
// Alto de la barra de pestañas encima del área segura (la flotante de iOS 26
// y la de Material) más un poco de aire.
const ALTO_PESTANAS = (ANDROID ? 80 : 64) + 12;
const CLAVE = 'app_burbuja_chat';
// Cuánto puede subir sobre su lugar.
const RECORRIDO = 240;

function leerPosicion() {
  try { const v = JSON.parse(leer(CLAVE) || 'null'); if (v) return { alto: Math.max(0, Math.min(RECORRIDO, Number(v.alto) || 0)) }; } catch { /* sin almacén */ }
  return { alto: 0 };
}

function Numero({ n }) {
  if (!n) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
      alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.rojo, borderWidth: 2, borderColor: '#fff' }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

function BurbujaFlotante() {
  const { user, hasPermission } = useAuth();
  const paleta = usePaleta();
  const segmentos = useSegments();
  const { top, bottom } = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const puede = !!user && !!hasPermission?.('chat_clientes', 'can_view');
  const { sinLeer, late } = useSinLeerDelChat({ activo: puede });
  const [teclado, setTeclado] = useState(false);
  const [escala] = useState(() => new Animated.Value(1));
  const [pos, setPos] = useState(leerPosicion);
  const arrastrando = useRef(false);
  const xy = useRef(new Animated.ValueXY({ x: W, y: H })).current;

  const enPestanas = segmentos[0] === '(tabs)';
  // `alto` se guarda como distancia sobre el piso, así sirve con y sin barra
  // de pestañas.
  const piso = H - bottom - (enPestanas ? ALTO_PESTANAS : MARGEN + 8) - TAMANO;
  const techo = Math.max(top + 96, piso - RECORRIDO);
  const escondida = !sinLeer;
  const destino = useMemo(() => {
    const y = Math.max(techo, Math.min(piso, piso - pos.alto));
    return { x: W - TAMANO - MARGEN, y };
  }, [pos, piso, techo, W, escondida]);

  const tam = useRef(new Animated.Value(sinLeer ? 1 : CHICA)).current;
  useEffect(() => {
    Animated.spring(tam, { toValue: escondida ? CHICA : 1, useNativeDriver: false, speed: 18, bounciness: 8 }).start();
  }, [escondida, tam]);

  useEffect(() => {
    if (arrastrando.current) return;
    Animated.spring(xy, { toValue: destino, useNativeDriver: false, speed: 18, bounciness: 6 }).start();
  }, [destino, xy]);

  const inicio = useRef({ x: 0, y: 0 });
  const arrastre = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => {
      arrastrando.current = true;
      xy.stopAnimation((v) => { inicio.current = v; });
      Haptics.selectionAsync().catch(() => {});
    },
    onPanResponderMove: (_, g) => xy.setValue({ x: inicio.current.x, y: Math.max(techo - 12, Math.min(piso + 12, inicio.current.y + g.dy)) }),
    onPanResponderRelease: (_, g) => {
      arrastrando.current = false;
      const y = inicio.current.y + g.dy;
      const nueva = { alto: Math.max(0, piso - Math.max(techo, Math.min(piso, y))) };
      try { guardar(CLAVE, JSON.stringify(nueva)); } catch { /* vale hasta cerrar la app */ }
      setPos(nueva);
    },
    onPanResponderTerminate: () => { arrastrando.current = false; setPos((p) => ({ ...p })); },
  }), [xy, W, piso, techo]);

  useEffect(() => {
    const a = Keyboard.addListener(ANDROID ? 'keyboardDidShow' : 'keyboardWillShow', () => setTeclado(true));
    const b = Keyboard.addListener(ANDROID ? 'keyboardDidHide' : 'keyboardWillHide', () => setTeclado(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // El latido: tres pulsos cuando el número sube.
  useEffect(() => {
    if (!late) return undefined;
    const pulso = Animated.sequence([
      Animated.timing(escala, { toValue: 1.18, duration: 180, useNativeDriver: false }),
      Animated.timing(escala, { toValue: 1, duration: 220, useNativeDriver: false }),
    ]);
    const anim = Animated.loop(pulso, { iterations: 3 });
    anim.start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return () => anim.stop();
  }, [late, escala]);

  const enElChat = segmentos.some((s) => String(s).startsWith('chat-clientes'));
  if (!puede || teclado || enElChat || segmentos[0] === 'entrar') return null;

  const etiqueta = sinLeer > 0
    ? `Chat con clientes: ${sinLeer} ${sinLeer === 1 ? 'mensaje' : 'mensajes'} sin responder. Desliza arriba o abajo para moverla.`
    : 'Chat con clientes. Desliza arriba o abajo para moverla.';
  const abrir = () => { Haptics.selectionAsync().catch(() => {}); router.push('/chat-clientes'); };
  const icono = <IconoFijo name={iconoDe('MessageCircle')} size={22} color={ANDROID && paleta ? paleta.onPrimaryContainer : '#FFFFFF'} />;

  return (
    <Animated.View {...arrastre.panHandlers}
      style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: xy.x }, { translateY: xy.y }, { scale: Animated.multiply(escala, tam) }],
        opacity: escondida ? 0.85 : 1 }}>
      {ANDROID ? (
        <View style={{ borderRadius: 14, elevation: 6, backgroundColor: paleta?.primaryContainer ?? MARCA.azul }}>
          <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={etiqueta}
            android_ripple={{ color: 'rgba(127,127,127,0.24)', borderless: false }}
            style={{ width: TAMANO, height: TAMANO, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {icono}
          </Pressable>
          <Numero n={sinLeer} />
        </View>
      ) : (
        <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={etiqueta}>
          {({ pressed }) => (
            <View style={{ transform: [{ scale: pressed ? 0.93 : 1 }] }}>
              <Vidrio radio={TAMANO / 2} interactivo tinte="rgba(0,82,204,0.85)">
                <View style={{ width: TAMANO, height: TAMANO, alignItems: 'center', justifyContent: 'center' }}>{icono}</View>
              </Vidrio>
              <Numero n={sinLeer} />
            </View>
          )}
        </Pressable>
      )}
    </Animated.View>
  );
}

export default memo(BurbujaFlotante);
