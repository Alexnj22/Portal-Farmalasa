// El botón de agregar de la Tienda: abre la hoja de presentaciones
// (lib/agregarRapido.js). Dos formas: el «+» redondo sobre la foto de las filas
// horizontales y `bloque`, la píldora a lo ancho de la cuadrícula (2026-11-09),
// que dice «Elegir» cuando hay más de una presentación.
import { Text, View } from 'react-native';
import Presionable from './Presionable';
import Icono from './Icono';
import { agregarRapido } from '../lib/agregarRapido';
import { nombreProducto } from '../lib/catalogo';
import { useTema } from '../tema/tema';

export default function BotonAgregar({ p, bloque = false }) {
  const t = useTema();
  if (!p?.disponible && p?.disponible !== undefined) return null;
  const elegir = p.presentaciones > 1;
  if (bloque) {
    return (
      <Presionable onPress={() => agregarRapido(p)} accessibilityRole="button"
        accessibilityLabel={`${elegir ? 'Elegir presentación de' : 'Agregar'} ${nombreProducto(p.nombre)}`}
        hitSlop={{ top: 4, bottom: 4 }}
        style={({ pressed }) => ({ minHeight: 40, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
        <Icono sf={elegir ? 'square.stack.3d.up.fill' : 'plus'} respaldo="+" tam={13} color="#FFFFFF" />
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>{elegir ? 'Elegir' : 'Agregar'}</Text>
      </Presionable>
    );
  }
  return (
    <Presionable onPress={() => agregarRapido(p)} accessibilityRole="button" accessibilityLabel={`Agregar ${nombreProducto(p.nombre)} al carrito`}
      hitSlop={6} style={({ pressed }) => ({ position: 'absolute', right: 6, bottom: 6, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta,
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
        <Icono sf="plus" respaldo="+" tam={15} color="#FFFFFF" />
      </View>
    </Presionable>
  );
}
