import { Text, TextInput, View } from 'react-native';
import { useColorScheme } from 'react-native';
import { useTema } from '../tema/tema';
import { pozo } from '../tema/papel';

export default function Campo({ etiqueta, ...props }) {
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: tema.color.texto2, fontSize: tema.texto.cuerpo, fontWeight: '600' }}>{etiqueta}</Text>
      <TextInput
        placeholderTextColor={tema.color.texto3}
        style={{
          minHeight: tema.tam.toque,
          borderRadius: tema.radio.control,
          // Línea Mostrador · Campo «Pozo»: hundido, sin borde duro.
          backgroundColor: tema.color.hundida,
          boxShadow: pozo(oscuro),
          color: tema.color.texto,
          paddingHorizontal: 16,
          fontSize: tema.texto.cuerpo + 3,
        }}
        {...props}
      />
    </View>
  );
}
