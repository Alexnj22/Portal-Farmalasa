// La raíz de la app. El `AuthProvider` es EL MISMO del portal
// (src/context/AuthContext.jsx): la sesión, los permisos, el cierre por
// inactividad y el candado de módulos se deciden con el mismo código.
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useNotificationsChannel } from '@nucleo/hooks/useNotificationsChannel';
import { notificarActividad } from '@plataforma/cicloDeVida';
import { useTema } from '../tema/tema';
import BotonCampana from '../componentes/BotonCampana';
import { CapaDeProgreso } from '../componentes/Progreso';
import HojasAndroid, { instalarHojasAndroid } from '../componentes/HojasAndroid';
import Aurora from '../componentes/Aurora';
import { escucharToques, registrarAvisos } from '../componentes/avisos';
// Define la tarea del GPS de fondo de las rutas: iOS relanza la app sin pantalla
// para entregar posiciones, y la tarea tiene que existir desde el arranque.
import { revisarRastreoDeFondo } from '../plataforma/rastreoDeFondo';

// Android no trae la hoja de opciones ni el prompt de iOS: se instalan antes de
// que cualquier pantalla los pida (ver componentes/HojasAndroid).
instalarHojasAndroid();

// Lo que hace `App.jsx` del portal alrededor de las pantallas:
//  - al entrar, cargar salas, personal y catálogos al store (`fetchBoot`); sin
//    esto las pantallas nativas verían el store vacío;
//  - sin sesión, llevar a la entrada. La web lo hace con su guardia de rutas;
//    sin esto, «Salir» cerraba la sesión y dejaba un Inicio en blanco, y lo
//    mismo pasaría cuando la sesión se vence por inactividad.
function GuardiaDeSesion() {
  const { isAuthenticated, loading } = useAuth();
  const fetchBoot = useStaffStore((s) => s.fetchBoot);
  const segmentos = useSegments();
  useEffect(() => { if (isAuthenticated) fetchBoot(); }, [isAuthenticated, fetchBoot]);
  // Con sesión, el teléfono recibe los avisos de esta persona.
  useEffect(() => { if (isAuthenticated) registrarAvisos(); }, [isAuthenticated]);
  useEffect(() => (isAuthenticated ? escucharToques() : undefined), [isAuthenticated]);
  // Una ruta que ya terminó (o de ayer) no deja el GPS encendido; una viva se reanuda.
  useEffect(() => { if (isAuthenticated) Promise.resolve(revisarRastreoDeFondo()).catch(() => {}); }, [isAuthenticated]);
  useEffect(() => {
    if (loading) return;
    const enEntrada = !segmentos.length || segmentos[0] === 'entrar' || segmentos[0] === 'index';
    if (!isAuthenticated && !enEntrada) router.replace('/entrar');
  }, [isAuthenticated, loading, segmentos]);
  return isAuthenticated ? <CampanaEnVivo /> : null;
}

// La campana en vivo, como `AppLayout` en la web: trae lo no leído y escucha
// lo que llega. Sólo con sesión (el hook pide el usuario).
function CampanaEnVivo() {
  useNotificationsChannel();
  return null;
}

// Los colores de la navegación siguen al TELÉFONO (claro u oscuro), no al tema
// del portal: las barras, los títulos y los fondos son los del sistema. Con los
// del portal el título grande salía oscuro sobre oscuro (usuario, 2026-09-30).
// El fondo de las pantallas es transparente: detrás está la aurora (una sola,
// en la raíz) que da la personalidad de la marca a toda la app.
const CLARO = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent', card: '#F9F9F9' } };
const OSCURO = { ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent', card: '#1C1C1E' } };

export default function Raiz() {
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  return (
    <ThemeProvider value={oscuro ? OSCURO : CLARO}>
    <SafeAreaProvider>
      {/* Cada toque cuenta como actividad: es lo que en la web hacen el mouse
          y el teclado, y lo que mantiene viva la sesión. */}
      <View style={{ flex: 1 }} onTouchStart={notificarActividad}>
        <Aurora />
        <AuthProvider>
          <GuardiaDeSesion />
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerTintColor: tema.color.marca,
              // El título en el color del sistema (la flecha y los botones sí,
              // en el de la marca).
              headerTitleStyle: { color: oscuro ? '#FFFFFF' : '#000000' },
              // Sólo la flecha: el nombre de la pantalla anterior es el de la
              // barra de pestañas, que no significa nada para quien la usa.
              headerBackButtonDisplayMode: 'minimal',
              headerRight: () => <BotonCampana />,
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="entrar" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <CapaDeProgreso />
          <HojasAndroid />
        </AuthProvider>
      </View>
    </SafeAreaProvider>
    </ThemeProvider>
  );
}
