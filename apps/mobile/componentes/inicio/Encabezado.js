// El saludo: personal y compacto (usuario, 2026-09-30). «Buenas tardes,
// Alex» es el TÍTULO GRANDE de la barra del sistema —se encoge al desplazar—;
// acá queda la línea de abajo (sala · día) y la foto, que va a la derecha de
// la barra y lleva a «Yo».
import { Pressable, Text, Platform } from 'react-native';
import { router } from 'expo-router';
import { saludoDeLaHora } from '@nucleo/utils/inicio';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import Avatar from '../Avatar';

export function saludo(user) {
  const nombre = shortEmployeeName(user).split(/\s+/)[0] || '';
  return `${saludoDeLaHora()}, ${nombre.charAt(0) + nombre.slice(1).toLowerCase()}`;
}

// La foto canónica (2026-11-06): con su aro, la torta el día del cumpleaños
// y su medalla, igual que en el portal.
export function FotoDeCuenta({ user, tamano = 36 }) {
  return (
    <Pressable onPress={() => router.navigate('/yo')} accessibilityRole="button" accessibilityLabel="Mi cuenta" hitSlop={6}>
      <Avatar empleado={user} tamano={tamano} />
    </Pressable>
  );
}

export default function Encabezado({ sala }) {
  const hoy = new Date().toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 15, paddingHorizontal: 20, marginTop: Platform.OS === 'ios' ? -6 : 12 }} numberOfLines={1}>
      {[sala, hoy.charAt(0).toUpperCase() + hoy.slice(1)].filter(Boolean).join(' · ')}
    </Text>
  );
}
