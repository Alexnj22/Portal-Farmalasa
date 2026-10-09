// La raíz: el fondo de la marca, la sesión desde el llavero y la guardia que
// manda a la bienvenida a quien no tiene sesión.
import { useEffect, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Aurora from '../componentes/Aurora';
import { useAppActiva } from '../lib/visible';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useSesion } from '../lib/sesion';
import { conReporte } from '../lib/errores';
import { llamar } from '../lib/api';
import { useCuenta } from '../lib/cuenta';
import { useOfertas } from '../lib/ofertas';
import { useBloqueo, vigilarCicloDeVida } from '../lib/bloqueo';
import PantallaBloqueo from '../componentes/PantallaBloqueo';
import * as Notifications from 'expo-notifications';
import { useTema } from '../tema/tema';
import { colorSistema } from '../componentes/sistema';
import { navegar } from '../lib/navegar';
import AvisoSinConexion from '../componentes/AvisoSinConexion';
import HojasAndroid, { instalarHojasAndroid } from '../componentes/HojasAndroid';

// La hoja de opciones y el prompt de iOS, en Android (componentes/HojasAndroid).
instalarHojasAndroid();
import AvisoEnApp from '../componentes/AvisoEnApp';
export { default as ErrorBoundary } from '../componentes/ErrorDePantalla';

const CLARO = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };
const OSCURO = { ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent' } };
const PUBLICAS = new Set(['bienvenida', 'entrar', 'registro']);
// Se ven con o sin sesión: la vitrina, las sucursales y el detalle de una oferta.
const ABIERTAS = new Set(['vitrina', 'sucursales', 'oferta', 'o', 'producto', 'mis-puntos', 'legal']);
const WEB = Platform.OS === 'web';
let entradaAutomaticaHecha = false;

// En el navegador (la vista previa con `expo start --web`) el documento tiene
// su propio fondo, que es lo que Safari pinta bajo la barra de estado y bajo
// su barra de abajo: sin esto se ven dos franjas blancas sobre la aurora. Y
// `viewport-fit=cover` deja que la página llegue hasta los bordes del iPhone.
function usarFondoDelDocumento(base) {
  useEffect(() => {
    if (!WEB || typeof document === 'undefined') return;
    document.documentElement.style.backgroundColor = base;
    document.body.style.backgroundColor = base;
    const vp = document.querySelector('meta[name=viewport]');
    if (vp && !vp.content.includes('viewport-fit')) vp.content += ', viewport-fit=cover';
    let tema = document.querySelector('meta[name=theme-color]');
    if (!tema) { tema = document.createElement('meta'); tema.name = 'theme-color'; document.head.appendChild(tema); }
    tema.content = base;
  }, [base]);
}

function Guardia() {
  const { token, lista, cargar } = useSesion();
  const segmentos = useSegments();
  useEffect(() => { cargar(); }, [cargar]);
  // Sólo en desarrollo (`__DEV__`, nunca en una compilación de tienda), y sólo
  // si el `.env` local trae un código de PRUEBAS: entra solo UNA vez al abrir,
  // para revisar pantallas en el simulador sin teclear. Una vez por arranque y
  // no «cada vez que no hay sesión»: si no, «Cerrar sesión» volvía a entrar
  // solo al instante y parecía que no cerraba (usuario, 2026-10-05).
  useEffect(() => {
    const codigo = process.env.EXPO_PUBLIC_PRUEBA_CODIGO;
    if (!__DEV__ || !codigo || !lista || token || entradaAutomaticaHecha) return;
    entradaAutomaticaHecha = true;
    llamar('entrar', { documento: codigo, plataforma: 'ios', dispositivo: 'simulador' })
      .then((r) => { if (r?.ok && r.token) useSesion.getState().abrir(r.token); })
      .catch(() => {});
  }, [lista, token]);
  useEffect(() => {
    if (!lista) return;
    if (ABIERTAS.has(segmentos[0])) return;
    const publica = PUBLICAS.has(segmentos[0]);
    // Sin sesión se limpia TODO lo que la sesión anterior dejó en memoria: en un
    // teléfono compartido, el siguiente cliente no debe ver ni un instante las
    // ofertas exclusivas ni el saldo del anterior.
    // Al cambiar de lado se vacía la pila: lo que quedaba debajo (Entrar, o las
    // pestañas) se podía alcanzar con el gesto de volver.
    const limpiarPila = () => { if (router.canDismiss()) router.dismissAll(); };
    if (!token && !publica) { useCuenta.getState().limpiar(); useOfertas.getState().limpiar(); limpiarPila(); router.replace('/bienvenida'); }
    if (token && (publica || !segmentos.length)) { limpiarPila(); router.replace('/puntos'); }
  }, [token, lista, segmentos]);
  return null;
}

// Tocar un aviso abre la pantalla de la que habla (`data.url`: /puntos,
// /inyecciones, /oferta/…). También el aviso que abrió la app en frío.
function AbrirAviso() {
  const token = useSesion((s) => s.token);
  useEffect(() => {
    if (WEB || !token) return undefined;
    const ir = (r) => {
      const url = r?.notification?.request?.content?.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) navegar(url);
      // Atendido: que no se vuelva a abrir al entrar de nuevo en esta ejecución.
      Notifications.clearLastNotificationResponseAsync?.().catch?.(() => {});
    };
    Notifications.getLastNotificationResponseAsync().then(ir).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(ir);
    return () => sub.remove();
  }, [token]);
  return null;
}

// La aurora de la raíz: detrás de las pestañas la tapan las suyas, así que ahí
// se pausa; y siempre con la app en segundo plano.
function AuroraRaiz() {
  const segmentos = useSegments();
  const activa = useAppActiva();
  return <Aurora activa={activa && segmentos[0] !== '(tabs)'} />;
}

// El bloqueo con Face ID, encima de todo, sólo con sesión abierta.
function Bloqueo() {
  const token = useSesion((s) => s.token);
  const { bloqueada, activo, cargar } = useBloqueo();
  // Con el bloqueo encendido, al salir de la app se tapa el contenido: la foto
  // que iOS toma para el selector de apps mostraba el saldo y el QR aunque la
  // app «estuviera bloqueada» (revisión 2026-10-06). Igual que Wallet o un banco.
  const [cubierta, setCubierta] = useState(false);
  useEffect(() => { cargar(); return vigilarCicloDeVida(); }, [cargar]);
  useEffect(() => {
    if (!activo) return undefined;
    const sub = AppState.addEventListener('change', (e) => setCubierta(e !== 'active'));
    return () => sub.remove();
  }, [activo]);
  if (!token) return null;
  if (bloqueada) return <PantallaBloqueo />;
  return cubierta ? <PantallaBloqueo soloCubrir /> : null;
}

function Raiz() {
  const oscuro = useColorScheme() === 'dark';
  const t = useTema();
  usarFondoDelDocumento(oscuro ? '#0A090E' : '#F5F4F8');
  return (
    <ThemeProvider value={oscuro ? OSCURO : CLARO}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AuroraRaiz />
          <Guardia />
          <AbrirAviso />
          <StatusBar style="auto" />
          <Stack screenOptions={{
            ...BARRA_NATIVA,
            headerTintColor: t.color.magentaTexto,
            headerBackButtonDisplayMode: 'minimal',
            headerTitleStyle: { color: colorSistema.texto },
            contentStyle: { backgroundColor: 'transparent' },
          }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            {/* Oferta y producto: modal clásico. Con `formSheet` la pantalla
                salía NEGRA (compilación 22, 2026-10-07): el contenido con
                flex: 1 no tomaba alto. Para cerrar deslizando con el
                contenido desplazado, ver `CerrarDeslizando`. */}
            {/* Sin gesto de volver: detrás de las pestañas quedaba Entrar y
                deslizar mandaba un segundo al login (2026-10-07). */}
            <Stack.Screen name="bienvenida" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="entrar" options={{ title: 'Entrar' }} />
            <Stack.Screen name="registro" options={{ title: 'Unirme' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="oferta/[id]" options={{ presentation: 'modal', headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="producto/[id]" options={{ presentation: 'modal', headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="o/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="compras" options={{ title: 'Mis compras' }} />
            <Stack.Screen name="sucursales" options={{ title: 'Nuestras sucursales' }} />
            <Stack.Screen name="notificaciones" options={{ title: 'Notificaciones' }} />
            <Stack.Screen name="reservas" options={{ title: 'Mis reservas' }} />
            <Stack.Screen name="vitrina" options={{ title: 'Ofertas' }} />
            <Stack.Screen name="invitar" options={{ title: 'Invitar a un amigo' }} />
            <Stack.Screen name="legal" options={{ title: '' }} />
            <Stack.Screen name="inyecciones" options={{ title: 'Mis inyecciones' }} />
            <Stack.Screen name="facturas" options={{ title: 'Mis facturas' }} />
            <Stack.Screen name="encuesta" options={{ title: 'Encuesta' }} />
            <Stack.Screen name="tratamientos" options={{ title: 'Mis tratamientos' }} />
            <Stack.Screen name="mis-puntos" options={{ headerShown: false }} />
          </Stack>
          <AvisoSinConexion />
          {/* El aviso con la app abierta: debajo del bloqueo, que lo tapa. */}
          <AvisoEnApp />
          <Bloqueo />
          <HojasAndroid />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

export default conReporte(Raiz);
