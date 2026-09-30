// El saludo: personal y compacto (usuario, 2026-09-30). «Buenas tardes,
// Alex», la sala y el día en una línea, y la foto que lleva a «Yo».
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { saludoDeLaHora } from '@nucleo/utils/inicio';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';

export default function Encabezado({ user, sala }) {
  const nombre = shortEmployeeName(user).split(/\s+/)[0] || '';
  const hoy = new Date().toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'short' });
  const foto = user?.photo || user?.photo_url;
  const letras = shortEmployeeName(user).split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }} numberOfLines={1}>
          {saludoDeLaHora()}, {nombre.charAt(0) + nombre.slice(1).toLowerCase()}
        </Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, marginTop: 2 }} numberOfLines={1}>
          {[sala, hoy].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Pressable onPress={() => router.navigate('/yo')} accessibilityRole="button" accessibilityLabel="Mi cuenta">
        {foto
          ? <Image source={{ uri: foto }} style={{ width: 44, height: 44, borderRadius: 22 }} />
          : <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{letras}</Text>
            </View>}
      </Pressable>
    </View>
  );
}
