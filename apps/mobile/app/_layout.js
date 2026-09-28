// La raíz de la app. El `AuthProvider` es EL MISMO del portal
// (src/context/AuthContext.jsx): la sesión, los permisos, el cierre por
// inactividad y el candado de módulos se deciden con el mismo código.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@nucleo/context/AuthContext';
import { notificarActividad } from '@plataforma/cicloDeVida';
import { useTema } from '../tema/tema';

export default function Raiz() {
  const tema = useTema();
  return (
    <SafeAreaProvider>
      {/* Cada toque cuenta como actividad: es lo que en la web hacen el mouse
          y el teclado, y lo que mantiene viva la sesión. */}
      <View style={{ flex: 1, backgroundColor: tema.color.fondo }} onTouchStart={notificarActividad}>
        <AuthProvider>
          <StatusBar style={tema.nombre === 'solid-dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: tema.color.tarjeta },
              headerTintColor: tema.color.texto,
              contentStyle: { backgroundColor: tema.color.fondo },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="entrar" options={{ headerShown: false }} />
            <Stack.Screen name="inicio" options={{ title: 'Inicio' }} />
          </Stack>
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
