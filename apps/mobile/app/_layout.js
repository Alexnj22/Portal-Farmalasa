// La raíz de la app. El `AuthProvider` es EL MISMO del portal
// (src/context/AuthContext.jsx): la sesión, los permisos, el cierre por
// inactividad y el candado de módulos se deciden con el mismo código.
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useNotificationsChannel } from '@nucleo/hooks/useNotificationsChannel';
import { notificarActividad } from '@plataforma/cicloDeVida';
import { useTema } from '../tema/tema';
import BotonCampana from '../componentes/BotonCampana';
import { escucharToques, registrarAvisos } from '../componentes/avisos';

// Lo que hace `App.jsx` del portal alrededor de las pantallas:
//  - al entrar, cargar salas, personal y catálogos al store (`fetchBoot`); sin
//    esto las pantallas nativas verían el store vacío;
//  - sin sesión, llevar a la entrada. La web lo hace con su guardia de rutas;
//    sin esto, «Salir» cerraba la sesión y dejaba un Inicio en blanco, y lo
//    mismo pasaría cuando la sesión se vence por inactividad.
function GuardiaDeSesion() {
  const { isAuthenticated, loading, user } = useAuth();
  const fetchBoot = useStaffStore((s) => s.fetchBoot);
  const segmentos = useSegments();
  useEffect(() => { if (isAuthenticated) fetchBoot(); }, [isAuthenticated, fetchBoot]);
  // Con sesión, el teléfono recibe los avisos de esta persona.
  useEffect(() => { if (isAuthenticated) registrarAvisos(); }, [isAuthenticated]);
  useEffect(() => (isAuthenticated && user?.id ? escucharToques(user.id) : undefined), [isAuthenticated, user?.id]);
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

export default function Raiz() {
  const tema = useTema();
  return (
    <SafeAreaProvider>
      {/* Cada toque cuenta como actividad: es lo que en la web hacen el mouse
          y el teclado, y lo que mantiene viva la sesión. */}
      <View style={{ flex: 1, backgroundColor: tema.color.fondo }} onTouchStart={notificarActividad}>
        <AuthProvider>
          <GuardiaDeSesion />
          <StatusBar style={tema.nombre === 'solid-dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: tema.color.tarjeta },
              headerTintColor: tema.color.texto,
              contentStyle: { backgroundColor: tema.color.fondo },
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
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
