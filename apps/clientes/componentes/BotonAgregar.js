// El «+» redondo sobre la foto de un producto (Tienda «Vitrina», 2026-11-05):
// agrega al carrito sin abrir la ficha (lib/agregarRapido.js). Va en la
// esquina de abajo de la foto, con 44 pt de área para el dedo aunque el
// círculo mida 32.
import { View } from 'react-native';
import Presionable from './Presionable';
import Icono from './Icono';
import { agregarRapido } from '../lib/agregarRapido';
import { nombreProducto } from '../lib/catalogo';
import { useTema } from '../tema/tema';

export default function BotonAgregar({ p }) {
  const t = useTema();
  if (!p?.disponible && p?.disponible !== undefined) return null;
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
