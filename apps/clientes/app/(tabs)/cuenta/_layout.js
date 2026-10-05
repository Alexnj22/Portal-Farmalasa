import { Stack } from 'expo-router';
import { Platform, useColorScheme } from 'react-native';

export default function Pila() {
  const oscuro = useColorScheme() === 'dark';
  return (
    <Stack screenOptions={{
      // En la web el título grande y la barra transparente no corren el
      // contenido: el título quedaba encima. Ahí va una barra normal.
      headerLargeTitle: Platform.OS !== 'web',
      headerTransparent: Platform.OS !== 'web',
      headerStyle: Platform.OS === 'web' ? { backgroundColor: 'transparent' } : undefined,
      headerShadowVisible: false,
      headerBlurEffect: oscuro ? 'dark' : 'light',
      headerLargeTitleShadowVisible: false,
      contentStyle: { backgroundColor: 'transparent' },
    }}>
      <Stack.Screen name="index" options={{ title: 'Cuenta' }} />
    </Stack>
  );
}
