import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useTema } from '../tema/tema';

export default function Pendiente() {
  const { nombre } = useLocalSearchParams();
  const tema = useTema();
  return (
    <View style={{ flex: 1, padding: 24, gap: 8 }}>
      <Stack.Screen options={{ title: nombre || 'Pronto' }} />
      <Text style={{ color: tema.color.texto, fontSize: tema.texto.titulo, fontWeight: '800' }}>Pronto en la app</Text>
      <Text style={{ color: tema.color.texto2, fontSize: tema.texto.cuerpo + 2 }}>
        Esta pantalla todavía está sólo en el portal.
      </Text>
    </View>
  );
}
