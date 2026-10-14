// La burbuja del chat (2026-10-12): un botón abajo a la derecha, en todas las
// pantallas, que lleva a «Pregúntale a la farmacia».
//
// Rehecha el 2026-10-14 («que no rebote tanto»):
//   · ENTRA en calma —aparece y crece apenas, con un resorte crítico, sin
//     rebote— y nada se mueve si el teléfono pide reducir el movimiento;
//   · iPhone con iOS 26: Liquid Glass tintado en el magenta de la marca, con
//     la respuesta al toque del propio vidrio (`isInteractive`); iOS anterior,
//     el círculo sólido de siempre;
//   · Android: el FAB de Material 3 Expressive — 56 dp, esquinas de 16 que al
//     apretar se REDONDEAN con el resorte espacial (la forma acusa el toque),
//     la onda y la elevación del sistema;
//   · dice tres cosas: cuántas respuestas hay sin leer (el número rojo), y si
//     no hay ninguna, si la farmacia está EN LÍNEA (punto verde) o cerrada
//     (punto gris con la luna). Las dos salen de `resumen.chat` (el servidor
//     usa el mismo horario que el chat), y se refrescan al llegar el push de
//     una respuesta y al volver a la app.
//
// Montada UNA vez en la raíz (app/_layout.js), encima de las pantallas. Las
// hojas y los modales se presentan por encima y la tapan solos; además se
// esconde a propósito donde estorba o no tiene sentido — ver OCULTA.
import { useEffect } from 'react';
import { AppState, InteractionManager, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { M3, IOS } from './movimiento';
import { alLlegarAviso, esAvisoDeChat } from '../lib/avisos';
import { useCuenta } from '../lib/cuenta';
import { precargarChat } from '../lib/chatHilo';
import { useSesion } from '../lib/sesion';
import { useTapadaPorBloqueo } from '../lib/bloqueo';
import { LIVIANO } from '../lib/rendimiento';
import { navegar } from '../lib/navegar';
import { useTema } from '../tema/tema';

// Pantallas (primer segmento de la ruta) donde la burbuja NO va: el chat
// mismo, la entrada y el registro, los modales a pantalla completa, lo legal y
// las que tienen su propia barra de botones abajo (Facturas, la Encuesta).
const OCULTA = new Set(['chat', 'guia', 'bienvenida', 'entrar', 'registro', 'index', 'oferta', 'producto', 'o', 'mis-puntos', 'legal', 'encuesta', 'facturas']);
// Pestañas donde tampoco: el carrito tiene abajo la barra de «Reservar».
const PESTANA_OCULTA = new Set(['carrito']);

const TAM = 56;
const ANDROID = Platform.OS === 'android';
const VIDRIO = Platform.OS === 'ios' && (() => { try { return isLiquidGlassAvailable(); } catch { return false; } })();
// Lo que ocupa la barra de pestañas sobre el área segura: la de iOS (también
// la flotante de iOS 26) y la de Material en Android (80 dp), más un respiro
// (en Android, los 16 dp de margen del FAB).
const SOBRE_PESTANAS = Platform.OS === 'ios' ? 62 : 96;
const VERDE = '#34C759';
const PressableAnimado = Animated.createAnimatedComponent(Pressable);

export default function BurbujaChat() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const segmentos = useSegments();
  const token = useSesion((s) => s.token);
  // Con el bloqueo (2026-10-14, «la burbuja sale encima de la pantalla de
  // bloqueo»): se escondía con `bloqueada`, pero no con la TAPA —la pantalla de
  // bloqueo sin botón que se pone al abrir Recientes o el selector de apps—, y
  // la burbuja va en zIndex 900 (y con `elevation` en Android) sobre el 100 del
  // bloqueo: asomaba encima, también en la foto de Recientes. Ni antes de leer
  // del llavero si el bloqueo está encendido. El mismo store que el bloqueo.
  const bloqueada = useTapadaPorBloqueo();
  const resumen = useCuenta((s) => s.resumen);
  const reducir = useReducedMotion() || LIVIANO;
  const conFicha = !!resumen && !resumen.pendiente;
  const enPestanas = segmentos[0] === '(tabs)';
  const oculta = !segmentos.length || OCULTA.has(segmentos[0]) || (enPestanas && PESTANA_OCULTA.has(segmentos[1]));
  const visible = Platform.OS !== 'web' && !!token && !bloqueada && conFicha && !oculta;
  const sinLeer = Number(resumen?.chat?.sin_leer ?? resumen?.chat_sin_leer) || 0;
  // `null`: el servidor todavía no lo dice (una versión anterior) — sin punto.
  const abierta = typeof resumen?.chat?.abierta === 'boolean' ? resumen.chat.abierta : null;

  // Con sesión y sin resumen todavía (una pantalla que no lo pidió): se pide.
  useEffect(() => { if (token && !resumen) useCuenta.getState().cargar(); }, [token, resumen]);

  // El push de una respuesta trae el número sin esperar; al volver a la app se
  // refresca (con la vigencia de un minuto de lib/cuenta) — también «en línea».
  useEffect(() => {
    if (Platform.OS === 'web' || !token) return undefined;
    const quitar = alLlegarAviso((a) => { if (esAvisoDeChat(a)) useCuenta.getState().cargar({ forzar: true }); });
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') useCuenta.getState().cargar(); });
    return () => { quitar(); app.remove(); };
  }, [token]);

  // Abrir el chat al instante (2026-10-14): el hilo se trae a memoria ANTES
  // del toque —cuando la burbuja aparece, y otra vez cuando llega una
  // respuesta—, después de las interacciones para no competir con la pantalla
  // que se está dibujando. Así hasta la primera apertura pinta en el primer
  // cuadro (lib/chatHilo).
  useEffect(() => {
    if (!visible) return undefined;
    const tarea = InteractionManager.runAfterInteractions(() => { precargarChat({ sinLeer }); });
    return () => tarea.cancel?.();
  }, [visible, sinLeer]);

  // Entrada en calma: crece de 0.86 a 1 y aparece, con un resorte CRÍTICO
  // (sin pasarse). La opacidad sólo donde no hay Liquid Glass: el vidrio no se
  // dibuja si nace con opacidad 0 (animacion.js).
  const escala = useSharedValue(reducir ? 1 : 0.86);
  const opac = useSharedValue(reducir || VIDRIO ? 1 : 0);
  const radio = useSharedValue(16);
  const numero = useSharedValue(1);
  useEffect(() => {
    if (!visible) { escala.value = reducir ? 1 : 0.86; opac.value = reducir || VIDRIO ? 1 : 0; return; }
    if (reducir) { escala.value = 1; opac.value = 1; return; }
    const r = ANDROID ? M3.espacial : IOS.entrada;
    escala.value = withDelay(200, withSpring(1, r));
    opac.value = withDelay(200, withTiming(1, { duration: 180 }));
  }, [visible, reducir, escala, opac]);
  // Llega un mensaje: el número crece apenas y vuelve, sin rebote.
  useEffect(() => {
    if (!sinLeer || reducir) return;
    numero.value = withSequence(withTiming(1.15, { duration: 120 }), withSpring(1, ANDROID ? M3.efectos : IOS.suelta));
  }, [sinLeer, reducir, numero]);
  const animado = useAnimatedStyle(() => ({ opacity: opac.value, transform: [{ scale: escala.value }] }));
  const animadoNumero = useAnimatedStyle(() => ({ transform: [{ scale: numero.value }] }));
  const forma = useAnimatedStyle(() => ({ borderRadius: radio.value }));

  if (!visible) return null;
  const abajo = ins.bottom + (enPestanas ? SOBRE_PESTANAS : 16);
  const abrir = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); navegar('/chat'); };
  const estado = sinLeer ? `${sinLeer} ${sinLeer === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}`
    : abierta === true ? 'farmacia en línea' : abierta === false ? 'farmacia cerrada, te respondemos al abrir' : '';
  const etiqueta = `Pregúntale a la farmacia${estado ? `, ${estado}` : ''}`;
  const icono = <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={24} color="#FFFFFF" />;
  const borde = ANDROID ? colorSistema.fondo : (t.oscuro ? '#0A090E' : '#FFFFFF');

  let boton;
  if (ANDROID) {
    // FAB de Material 3 Expressive: la forma se redondea al apretar.
    boton = (
      <PressableAnimado onPress={abrir} hitSlop={6} accessibilityRole="button" accessibilityLabel={etiqueta}
        android_ripple={{ color: 'rgba(255,255,255,0.28)', foreground: true }}
        onPressIn={() => { radio.value = withSpring(TAM / 2, M3.espacialRapido); }}
        onPressOut={() => { radio.value = withSpring(16, M3.espacial); }}
        style={[{ width: TAM, height: TAM, overflow: 'hidden', elevation: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta }, forma]}>
        {icono}
      </PressableAnimado>
    );
  } else if (VIDRIO) {
    // Liquid Glass: el vidrio responde solo al toque (se ilumina y se estira).
    boton = (
      <Pressable onPress={abrir} hitSlop={6} accessibilityRole="button" accessibilityLabel={etiqueta}>
        <GlassView glassEffectStyle="regular" isInteractive tintColor={t.color.magenta}
          style={{ width: TAM, height: TAM, borderRadius: TAM / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(152,29,151,0.35)' }}>
          {icono}
        </GlassView>
      </Pressable>
    );
  } else {
    boton = (
      <Pressable onPress={abrir} hitSlop={6} accessibilityRole="button" accessibilityLabel={etiqueta}
        style={({ pressed }) => ({ width: TAM, height: TAM, borderRadius: TAM / 2, alignItems: 'center', justifyContent: 'center',
          backgroundColor: t.color.magenta, opacity: pressed ? 0.85 : 1,
          shadowColor: '#000', shadowOpacity: t.oscuro ? 0.5 : 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } })}>
        {icono}
      </Pressable>
    );
  }

  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', right: 16 + ins.right, bottom: abajo, zIndex: 900 }, animado]}>
      {boton}
      {sinLeer ? (
        <Animated.View pointerEvents="none" style={[estilos.numero, { backgroundColor: colorSistema.rojo, borderColor: borde, ...(ANDROID ? { elevation: 7 } : null) }, animadoNumero]}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF' }}>{sinLeer > 99 ? '99+' : String(sinLeer)}</Text>
        </Animated.View>
      ) : abierta === true ? (
        <View pointerEvents="none" style={[estilos.punto, { backgroundColor: VERDE, borderColor: borde, ...(ANDROID ? { elevation: 7 } : null) }]} />
      ) : abierta === false ? (
        <View pointerEvents="none" style={[estilos.punto, estilos.luna, { backgroundColor: '#8E8E93', borderColor: borde, ...(ANDROID ? { elevation: 7 } : null) }]}>
          <Icono sf="moon.fill" respaldo="☾" tam={9} color="#FFFFFF" />
        </View>
      ) : null}
    </Animated.View>
  );
}

const estilos = StyleSheet.create({
  numero: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  punto: { position: 'absolute', top: 1, right: 1, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  luna: { width: 18, height: 18, borderRadius: 9, top: -1, right: -1, alignItems: 'center', justifyContent: 'center' },
});
