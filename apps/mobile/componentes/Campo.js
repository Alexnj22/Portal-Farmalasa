import { Text, TextInput, View } from 'react-native';
import { useTema } from '../tema/tema';

export default function Campo({ etiqueta, ...props }) {
  const tema = useTema();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: tema.color.texto2, fontSize: tema.texto.cuerpo, fontWeight: '600' }}>{etiqueta}</Text>
      <TextInput
        placeholderTextColor={tema.color.texto3}
        style={{
          minHeight: tema.tam.toque,
          borderRadius: tema.radio.control,
          borderWidth: 1,
          borderColor: tema.color.borde,
          backgroundColor: tema.color.tarjeta,
          color: tema.color.texto,
          paddingHorizontal: 12,
          fontSize: tema.texto.cuerpo + 3,
        }}
        {...props}
      />
    </View>
  );
}
