// La raíz: el fondo de la marca, la sesión desde el llavero y la guardia que
// manda a la bienvenida a quien no tiene sesión.
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Aurora from '../componentes/Aurora';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useSesion } from '../lib/sesion';
import { llamar } from '../lib/api';
import { useCuenta } from '../lib/cuenta';
import { useTema } from '../tema/tema';
import { colorSistema } from '../componentes/sistema';

const CLARO = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };
const OSCURO = { ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent' } };
const PUBLICAS = new Set(['bienvenida', 'entrar', 'registro']);
const WEB = Platform.OS === 'web';

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
  // si el `.env` local trae un código de PRUEBAS: entra solo, para poder
  // revisar pantallas en el simulador sin teclear. Igual que la app del personal.
  useEffect(() => {
    const codigo = process.env.EXPO_PUBLIC_PRUEBA_CODIGO;
    if (!__DEV__ || !codigo || !lista || token) return;
    llamar('entrar', { documento: codigo, plataforma: 'ios', dispositivo: 'simulador' })
      .then((r) => { if (r?.ok && r.token) useSesion.getState().abrir(r.token); })
      .catch(() => {});
  }, [lista, token]);
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
  usarFondoDelDocumento(oscuro ? '#0A090E' : '#F5F4F8');
  return (
    <ThemeProvider value={oscuro ? OSCURO : CLARO}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Aurora />
          <Guardia />
          <StatusBar style="auto" />
          <Stack screenOptions={{
            ...BARRA_NATIVA,
            headerTintColor: t.color.magentaTexto,
            headerBackButtonDisplayMode: 'minimal',
            headerTitleStyle: { color: colorSistema.texto },
            contentStyle: { backgroundColor: 'transparent' },
          }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="bienvenida" options={{ headerShown: false }} />
            <Stack.Screen name="entrar" options={{ title: 'Entrar' }} />
            <Stack.Screen name="registro" options={{ title: 'Unirme' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="oferta/[id]" options={{ title: '' }} />
          </Stack>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
