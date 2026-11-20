import { Text } from 'react-native';
import { Presionable as Pressable } from './Tocable';
import Indicador from './Indicador';
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
        // Línea Mostrador · Botón «Brillo»: píldora con luz interior y el
        // resplandor de la marca; apretado .96, apagado .45.
        boxShadow: apagado || typeof tema.color.marca !== 'string' ? undefined
          : `inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08), 0 8px 20px -8px ${tema.color.marca}99`,
        opacity: apagado ? 0.45 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {ocupado ? <Indicador color="#fff" /> : (
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: tema.texto.cuerpo + 2 }}>{children}</Text>
      )}
    </Pressable>
  );
}
