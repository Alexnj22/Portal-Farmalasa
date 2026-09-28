import { ActivityIndicator, Pressable, Text } from 'react-native';
import { useTema } from '../tema/tema';

/** El botón de la app: blanco de dedo de 44 y acuse al tocar (DESIGN.md §32). */
export default function Boton({ children, onPress, ocupado = false, deshabilitado = false }) {
  const tema = useTema();
  const apagado = deshabilitado || ocupado;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={apagado}
      style={({ pressed }) => ({
        minHeight: tema.tam.toque,
        borderRadius: tema.radio.boton,
        backgroundColor: tema.color.marca,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        opacity: apagado ? 0.5 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {ocupado ? <ActivityIndicator color="#fff" /> : (
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: tema.texto.cuerpo + 2 }}>{children}</Text>
      )}
    </Pressable>
  );
}
