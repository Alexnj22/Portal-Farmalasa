// El saludo: personal y compacto (usuario, 2026-09-30). «Buenas tardes,
// Alex» es el TÍTULO GRANDE de la barra del sistema —se encoge al desplazar—;
// acá queda la línea de abajo (sala · día) y la foto, que va a la derecha de
// la barra y lleva a «Yo».
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { saludoDeLaHora } from '@nucleo/utils/inicio';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';

export function saludo(user) {
  const nombre = shortEmployeeName(user).split(/\s+/)[0] || '';
  return `${saludoDeLaHora()}, ${nombre.charAt(0) + nombre.slice(1).toLowerCase()}`;
}

export function FotoDeCuenta({ user, tamano = 34 }) {
  const foto = user?.photo || user?.photo_url;
  const letras = shortEmployeeName(user).split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  return (
    <Pressable onPress={() => router.navigate('/yo')} accessibilityRole="button" accessibilityLabel="Mi cuenta" hitSlop={6}>
      {foto
        ? <Image source={{ uri: foto }} style={{ width: tamano, height: tamano, borderRadius: tamano / 2 }} />
        : <View style={{ width: tamano, height: tamano, borderRadius: tamano / 2, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.texto, fontWeight: '700', fontSize: tamano * 0.38 }}>{letras}</Text>
          </View>}
    </Pressable>
  );
}

export default function Encabezado({ sala }) {
  const hoy = new Date().toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 15, paddingHorizontal: 20, marginTop: -6 }} numberOfLines={1}>
      {[sala, hoy.charAt(0).toUpperCase() + hoy.slice(1)].filter(Boolean).join(' · ')}
    </Text>
  );
}
