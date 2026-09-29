// Cada pestaña lleva su propia pila, que es lo que le da la barra de título del
// sistema (con el título grande de iOS donde corresponde).
import { Stack } from 'expo-router';

// `sinBarra`: la pestaña muestra el portal, que ya trae su propio título.
export default function PilaDePestana({ titulo, grande = false, sinBarra = false }) {
  return (
    <Stack screenOptions={{ headerLargeTitle: grande }}>
      <Stack.Screen name="index" options={{ title: titulo, headerShown: !sinBarra }} />
    </Stack>
  );
}
