// La burbuja del chat (2026-10-12): un botón redondo abajo a la derecha, en
// todas las pantallas, que lleva a «Pregúntale a la farmacia» y dice cuántas
// respuestas del equipo están sin leer. Es el mismo número que la fila de
// Cuenta (`resumen.chat_sin_leer`, de lib/cuenta): las dos leen el mismo
// estado, así que no pueden decir cosas distintas.
//
// Montada UNA vez en la raíz (app/_layout.js), encima de las pantallas. Las
// hojas y los modales (reservar, una oferta, una celebración) se presentan
// por encima y la tapan solos; además se esconde a propósito donde estorba o
// no tiene sentido — ver OCULTA.
//
// El número se refresca al llegar el push de una respuesta y al volver a la
// app. Sin opacidad de entrada (animacion.js): sube y crece con un resorte,
// y nada se mueve si el teléfono pide reducir el movimiento o es liviano.
import { useEffect } from 'react';
import { AppState, Platform, Text } from 'react-native';
import Presionable from './Presionable';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { alLlegarAviso, esAvisoDeChat } from '../lib/avisos';
import { useCuenta } from '../lib/cuenta';
import { useSesion } from '../lib/sesion';
import { useBloqueo } from '../lib/bloqueo';
import { LIVIANO } from '../lib/rendimiento';
import { navegar } from '../lib/navegar';
import { useTema } from '../tema/tema';

// Pantallas (primer segmento de la ruta) donde la burbuja NO va: el chat
// mismo, la entrada y el registro, los modales a pantalla completa, lo legal y
// las que tienen su propia barra de botones abajo (Facturas, la Encuesta).
const OCULTA = new Set(['chat', 'bienvenida', 'entrar', 'registro', 'index', 'oferta', 'producto', 'o', 'mis-puntos', 'legal', 'encuesta', 'facturas']);
// Pestañas donde tampoco: el carrito tiene abajo la barra de «Reservar».
const PESTANA_OCULTA = new Set(['carrito']);

const TAM = 56;
const ANDROID = Platform.OS === 'android';
// Lo que ocupa la barra de pestañas sobre el área segura: la de iOS (también
// la flotante de iOS 26) y la de Material en Android (80 dp), más un respiro
// (en Android, los 16 dp de margen del FAB).
const SOBRE_PESTANAS = Platform.OS === 'ios' ? 62 : 96;
// Android (2026-10-13): el FAB de Material 3 — 56 dp, esquinas de 16 (no un
// círculo), elevación 3 del sistema en vez de sombra dibujada y la onda al tocar.
const FORMA = ANDROID
  ? { borderRadius: 16, overflow: 'hidden', elevation: 6 }
  : { borderRadius: TAM / 2 };

export default function BurbujaChat() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const segmentos = useSegments();
  const token = useSesion((s) => s.token);
  const bloqueada = useBloqueo((s) => s.bloqueada);
  const resumen = useCuenta((s) => s.resumen);
  const reducir = useReducedMotion() || LIVIANO;
  const conFicha = !!resumen && !resumen.pendiente;
  const enPestanas = segmentos[0] === '(tabs)';
  const oculta = !segmentos.length || OCULTA.has(segmentos[0]) || (enPestanas && PESTANA_OCULTA.has(segmentos[1]));
  const visible = Platform.OS !== 'web' && !!token && !bloqueada && conFicha && !oculta;
  const sinLeer = Number(resumen?.chat_sin_leer) || 0;

  // Con sesión y sin resumen todavía (una pantalla que no lo pidió): se pide.
  useEffect(() => { if (token && !resumen) useCuenta.getState().cargar(); }, [token, resumen]);

  // El push de una respuesta suma al número sin esperar el próximo resumen;
  // al volver a la app se refresca (con la vigencia de un minuto de lib/cuenta).
  useEffect(() => {
    if (Platform.OS === 'web' || !token) return undefined;
    const quitar = alLlegarAviso((a) => { if (esAvisoDeChat(a)) useCuenta.getState().cargar({ forzar: true }); });
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') useCuenta.getState().cargar(); });
    return () => { quitar(); app.remove(); };
  }, [token]);

  // Entrada: sube desde abajo y crece. El número late una vez cuando sube.
  const escala = useSharedValue(reducir ? 1 : 0.4);
  const y = useSharedValue(reducir ? 0 : 40);
  const latido = useSharedValue(1);
  useEffect(() => {
    if (!visible) { escala.value = reducir ? 1 : 0.4; y.value = reducir ? 0 : 40; return; }
    if (reducir) { escala.value = 1; y.value = 0; return; }
    escala.value = withDelay(250, withSpring(1, { damping: 14, stiffness: 180 }));
    y.value = withDelay(250, withSpring(0, { damping: 18, stiffness: 180 }));
  }, [visible, reducir, escala, y]);
  useEffect(() => {
    if (!sinLeer || reducir) return;
    latido.value = 1.25;
    latido.value = withSpring(1, { damping: 8, stiffness: 260 });
  }, [sinLeer, reducir, latido]);
  const animado = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { scale: escala.value }] }));
  const animadoNumero = useAnimatedStyle(() => ({ transform: [{ scale: latido.value }] }));

  if (!visible) return null;
  const abajo = ins.bottom + (enPestanas ? SOBRE_PESTANAS : 16);
  const abrir = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); navegar('/chat'); };
  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', right: 16 + ins.right, bottom: abajo, zIndex: 900 }, animado]}>
      <Presionable onPress={abrir} hitSlop={6} accessibilityRole="button"
        accessibilityLabel={sinLeer ? `Pregúntale a la farmacia, ${sinLeer} ${sinLeer === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}` : 'Pregúntale a la farmacia'}
        android_ripple={{ color: 'rgba(255,255,255,0.28)', foreground: true }}
        style={({ pressed }) => ({ width: TAM, height: TAM, ...FORMA, alignItems: 'center', justifyContent: 'center',
          backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.92 : 1 }],
          shadowColor: '#000', shadowOpacity: t.oscuro ? 0.5 : 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 })}>
        <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={24} color="#FFFFFF" />
      </Presionable>
      {sinLeer ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
          alignItems: 'center', justifyContent: 'center', backgroundColor: colorSistema.rojo, borderWidth: 2, borderColor: ANDROID ? colorSistema.fondo : (t.oscuro ? '#0A090E' : '#FFFFFF'),
          ...(ANDROID ? { elevation: 7 } : null) }, animadoNumero]}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF' }}>{sinLeer > 99 ? '99+' : String(sinLeer)}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
