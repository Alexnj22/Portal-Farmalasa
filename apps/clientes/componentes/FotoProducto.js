// La foto de un producto, o —si todavía no tiene— un cuadro con su color y sus
// iniciales: casi todo el catálogo está sin foto y no puede verse vacío.
import { Text, View } from 'react-native';
import { Image as ImagenCache } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Icono from './Icono';
import { iniciales, tonoDe } from '../lib/catalogo';

export default function FotoProducto({ id, nombre, foto, alto = 120, radio = 16, grande = false }) {
  if (foto) {
    return (
      <View style={{ height: alto, borderRadius: radio, backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
        <ImagenCache source={{ uri: foto }} cachePolicy="memory-disk" contentFit="contain" transition={150}
          style={{ flex: 1, margin: grande ? 18 : 10 }} />
      </View>
    );
  }
  const [a, b] = tonoDe(id);
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ height: alto, borderRadius: radio, alignItems: 'center', justifyContent: 'center', gap: grande ? 10 : 4 }}>
      <Icono sf="pills.fill" respaldo="" tam={grande ? 34 : 20} color="rgba(255,255,255,0.85)" />
      <Text style={{ color: '#FFFFFF', fontSize: grande ? 28 : 18, fontWeight: '900', letterSpacing: 1 }}>{iniciales(nombre)}</Text>
    </LinearGradient>
  );
}
