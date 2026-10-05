import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function Pila() {
  const oscuro = useColorScheme() === 'dark';
  return (
    <Stack screenOptions={{
      headerLargeTitle: true,
      headerTransparent: true,
      headerBlurEffect: oscuro ? 'dark' : 'light',
      headerLargeTitleShadowVisible: false,
      contentStyle: { backgroundColor: 'transparent' },
    }}>
      <Stack.Screen name="index" options={{ title: 'Inyecciones' }} />
    </Stack>
  );
}
