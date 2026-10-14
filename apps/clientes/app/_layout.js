// La raíz: el fondo de la marca, la sesión desde el llavero y la guardia que
// manda a la bienvenida a quien no tiene sesión.
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Aurora from '../componentes/Aurora';
import { useAppActiva } from '../lib/visible';
import { BARRA_NATIVA, barraAndroid } from '../componentes/PilaDePestana';
import * as SystemUI from 'expo-system-ui';
import { useSesion } from '../lib/sesion';
import { conReporte } from '../lib/errores';
import { llamar } from '../lib/api';
import { useCuenta } from '../lib/cuenta';
import { useOfertas } from '../lib/ofertas';
import { useBloqueo, useCubierta, vigilarCicloDeVida } from '../lib/bloqueo';
import PantallaBloqueo from '../componentes/PantallaBloqueo';
import * as Notifications from 'expo-notifications';
import { useTema } from '../tema/tema';
import { colorSistema } from '../componentes/sistema';
import { navegar } from '../lib/navegar';
import { esAccionDeToma, instalarTomas } from '../lib/tomas';
import AvisoSinConexion from '../componentes/AvisoSinConexion';
import HojasAndroid, { instalarHojasAndroid } from '../componentes/HojasAndroid';
import NovedadesHoja from '../componentes/NovedadesHoja';
import { guiaVista, revisarAlAbrir, usePresentacion } from '../lib/novedades';

// La hoja de opciones y el prompt de iOS, en Android (componentes/HojasAndroid).
instalarHojasAndroid();
// Los botones «Tomado» / «Más tarde» del recordatorio de tomas (2026-10-12):
// el oyente va desde el arranque para no perder el que despertó a la app.
instalarTomas();
import AvisoEnApp from '../componentes/AvisoEnApp';
import BurbujaChat from '../componentes/BurbujaChat';
import { despertar } from '../componentes/reposo';
export { default as ErrorBoundary } from '../componentes/ErrorDePantalla';

const CLARO = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };
const OSCURO = { ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent' } };
// Android (2026-10-13, «las transiciones no se ven bien»): cada pantalla tiene
// su fondo OPACO —la superficie de Material 3— y entra con la animación de
// Android. Con fondos transparentes sobre una aurora global, durante la
// transición se veía la pantalla de atrás a través de la de adelante, y el
// sistema tenía que componer las dos más la aurora en cada cuadro. Mismo
// arreglo que la app del personal (apps/mobile/app/_layout.js).
const ANDROID = Platform.OS === 'android';
const CLARO_ANDROID = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#F5F4F9', card: '#F5F4F9' } };
const OSCURO_ANDROID = { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#131218', card: '#131218' } };
// Hacia adelante, la pantalla entra deslizándose desde la derecha (el eje
// compartido de Material); las que en iPhone son hojas (una oferta, un
// producto) suben desde abajo. Las dos las anima el sistema, no JavaScript.
const MODAL_ANDROID = ANDROID ? { animation: 'slide_from_bottom' } : {};
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
      // Un botón del recordatorio de tomas no abre nada: lo atiende lib/tomas.
      if (esAccionDeToma(r)) return;
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

// El primer inicio y «Qué hay de nuevo» (2026-10-14, lib/novedades.js).
//   · La GUÍA sale después de una entrada o un registro HECHOS AHORA (el token
//     pasa de no estar a estar), nunca al abrir con la sesión ya guardada ni a
//     quien mira sin cuenta. Una vez por teléfono.
//   · Las NOVEDADES se revisan al arrancar: sólo tras una actualización.
// Las dos esperan a que se vean las pestañas y a que no esté el bloqueo
// encima: así no tapan el login, la pantalla de Face ID ni una oferta abierta
// desde un aviso.
function Presentacion() {
  const token = useSesion((s) => s.token);
  const lista = useSesion((s) => s.lista);
  const bloqueada = useBloqueo((s) => s.bloqueada);
  const segmentos = useSegments();
  const guiaPendiente = usePresentacion((s) => s.guiaPendiente);
  const novedades = usePresentacion((s) => s.novedades);
  const pendientes = usePresentacion((s) => s.novedadesPendientes);
  // El token con el que arrancó la app (undefined = todavía no se leyó el llavero).
  const inicial = useRef(undefined);
  useEffect(() => {
    if (WEB || !lista) return;
    if (inicial.current === undefined) { inicial.current = token; revisarAlAbrir(!!token); return; }
    const antes = inicial.current;
    inicial.current = token;
    if (!antes && token) guiaVista().then((vista) => { if (!vista) usePresentacion.getState().pedirGuia(); });
  }, [lista, token]);
  const enPestanas = segmentos[0] === '(tabs)';
  useEffect(() => {
    if (!token || bloqueada || !enPestanas) return undefined;
    if (guiaPendiente) {
      // Un respiro: que termine la transición de Entrar a las pestañas.
      const reloj = setTimeout(() => { if (usePresentacion.getState().guiaPendiente) router.push('/guia'); }, 500);
      return () => clearTimeout(reloj);
    }
    if (pendientes) {
      const reloj = setTimeout(() => usePresentacion.getState().abrirNovedades(pendientes), 800);
      return () => clearTimeout(reloj);
    }
    return undefined;
  }, [token, bloqueada, enPestanas, guiaPendiente, pendientes]);
  if (!token || bloqueada || !novedades) return null;
  return <NovedadesHoja novedades={novedades} alCerrar={() => usePresentacion.getState().cerrarNovedades()} />;
}

const BARRA_CHAT = {
  headerTransparent: true,
  headerBlurEffect: 'none',
  headerShadowVisible: false,
  headerStyle: { backgroundColor: 'transparent' },
  contentStyle: { backgroundColor: 'transparent' },
  scrollEdgeEffects: { top: 'hidden', bottom: 'hidden', left: 'hidden', right: 'hidden' },
};

// La aurora de la raíz: detrás de las pestañas la tapan las suyas, así que ahí
// se pausa; y siempre con la app en segundo plano.
function AuroraRaiz() {
  const segmentos = useSegments();
  const activa = useAppActiva();
  // (2026-10-14) Detrás del chat se ve, pero QUIETA: dibujada una vez, nada
  // que redibujar por cuadro mientras se desplaza el hilo o sube el teclado.
  return <Aurora activa={activa && segmentos[0] !== '(tabs)' && segmentos[0] !== 'chat'} />;
}

// El bloqueo con Face ID, encima de todo, sólo con sesión abierta.
function Bloqueo() {
  const token = useSesion((s) => s.token);
  const { bloqueada, activo, cargar } = useBloqueo();
  // Con el bloqueo encendido, al salir de la app se tapa el contenido: la foto
  // que iOS toma para el selector de apps mostraba el saldo y el QR aunque la
  // app «estuviera bloqueada» (revisión 2026-10-06). Igual que Wallet o un banco.
  // En Android, con `blur` (Recientes), y sin tapar lo que la app abrió a propósito (lib/bloqueo, 2026-10-14).
  const cubierta = useCubierta(activo);
  useEffect(() => { cargar(); return vigilarCicloDeVida(); }, [cargar]);
  if (!token) return null;
  if (bloqueada) return <PantallaBloqueo />;
  return cubierta ? <PantallaBloqueo soloCubrir /> : null;
}

function Raiz() {
  const oscuro = useColorScheme() === 'dark';
  const t = useTema();
  usarFondoDelDocumento(oscuro ? '#0A090E' : '#F5F4F8');
  // Android: el fondo de la VENTANA en el color de la superficie. Es lo que se
  // ve un instante entre una pantalla y otra, al abrir el teclado o al volver
  // con el gesto: sin esto era blanco también en modo oscuro (el destello).
  useEffect(() => {
    if (ANDROID) SystemUI.setBackgroundColorAsync(colorSistema.fondo).catch(() => {});
  }, [oscuro]);
  const pila = ANDROID
    ? { ...barraAndroid(), headerTintColor: t.color.magentaTexto, animation: 'slide_from_right' }
    : {
        ...BARRA_NATIVA,
        headerTintColor: t.color.magentaTexto,
        headerBackButtonDisplayMode: 'minimal',
        headerTitleStyle: { color: colorSistema.texto },
        contentStyle: { backgroundColor: 'transparent' },
      };
  return (
    <ThemeProvider value={ANDROID ? (oscuro ? OSCURO_ANDROID : CLARO_ANDROID) : (oscuro ? OSCURO : CLARO)}>
      <SafeAreaProvider>
        {/* Cualquier toque despierta lo que se anima solo y estaba en reposo
            (componentes/reposo.js, 2026-10-14): el evento sube desde la vista
            tocada sin quitarle el gesto a nadie. */}
        <GestureHandlerRootView style={{ flex: 1 }} onTouchStart={despertar}>
          {/* Android: sin aurora (componentes/Aurora.android.js); el fondo lo da cada pantalla. */}
          {ANDROID ? null : <AuroraRaiz />}
          <Guardia />
          <AbrirAviso />
          <StatusBar style="auto" />
          <Stack screenOptions={pila}>
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
            <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false, ...(ANDROID ? { animation: 'fade' } : {}) }} />
            <Stack.Screen name="oferta/[id]" options={{ presentation: 'modal', headerShown: false, gestureEnabled: true, ...MODAL_ANDROID }} />
            <Stack.Screen name="producto/[id]" options={{ presentation: 'modal', headerShown: false, gestureEnabled: true, ...MODAL_ANDROID }} />
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
            {/* El chat (2026-10-14): barra transparente sobre la aurora, como antes,
                pero SIN los «scroll edge effects» de iOS 26 (difuminaban el hilo,
                que va invertido) y sin desenfoque propio: la misma barra quieta y
                al desplazar. La lista empieza debajo de ella (app/chat.js). */}
            <Stack.Screen name="chat" options={{ title: 'Pregúntale a la farmacia', ...(ANDROID ? {} : BARRA_CHAT) }} />
            <Stack.Screen name="mis-puntos" options={{ headerShown: false }} />
            {/* El primer inicio (2026-10-14): modal a pantalla completa con la
                animación del sistema; sin gesto para bajarla (tiene «Saltar»). */}
            <Stack.Screen name="guia" options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false, ...MODAL_ANDROID }} />
          </Stack>
          <AvisoSinConexion />
          {/* La burbuja del chat (2026-10-12): encima de las pantallas y debajo
              de los avisos y del bloqueo. Dónde se esconde: componentes/BurbujaChat. */}
          <BurbujaChat />
          {/* El aviso con la app abierta: debajo del bloqueo, que lo tapa. */}
          <AvisoEnApp />
          <Presentacion />
          <Bloqueo />
          <HojasAndroid />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

export default conReporte(Raiz);
