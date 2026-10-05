// La raíz: el fondo de la marca, la sesión desde el llavero y la guardia que
// manda a la bienvenida a quien no tiene sesión.
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Aurora from '../componentes/Aurora';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { useTema } from '../tema/tema';

const CLARO = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };
const OSCURO = { ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent' } };
const PUBLICAS = new Set(['bienvenida', 'entrar', 'registro']);

function Guardia() {
  const { token, lista, cargar } = useSesion();
  const segmentos = useSegments();
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!lista) return;
    const publica = PUBLICAS.has(segmentos[0]);
    if (!token && !publica) { useCuenta.getState().limpiar(); router.replace('/bienvenida'); }
    if (token && (publica || !segmentos.length)) router.replace('/puntos');
  }, [token, lista, segmentos]);
  return null;
}

export default function Raiz() {
  const oscuro = useColorScheme() === 'dark';
  const t = useTema();
  return (
    <ThemeProvider value={oscuro ? OSCURO : CLARO}>
      <SafeAreaProvider>
        <View style={{ flex: 1 }}>
          <Aurora />
          <Guardia />
          <StatusBar style="auto" />
          <Stack screenOptions={{
            headerTintColor: t.color.magentaTexto,
            headerBackButtonDisplayMode: 'minimal',
            headerTransparent: true,
            headerBlurEffect: oscuro ? 'dark' : 'light',
          }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="bienvenida" options={{ headerShown: false }} />
            <Stack.Screen name="entrar" options={{ title: 'Entrar' }} />
            <Stack.Screen name="registro" options={{ title: 'Unirme' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </View>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
