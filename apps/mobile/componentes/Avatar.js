// La cara de una persona: su foto o, si no tiene, sus iniciales — sacadas del
// nombre corto canónico (primer nombre + primer apellido).
import { Image, Text, View } from 'react-native';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from './Formulario';

export default function Avatar({ empleado, tamano = 40 }) {
  const foto = empleado?.photo || empleado?.photo_url;
  const r = tamano / 2;
  if (foto) return <Image source={{ uri: foto }} style={{ width: tamano, height: tamano, borderRadius: r }} />;
  const letras = shortEmployeeName(empleado).split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  return (
    <View style={{ width: tamano, height: tamano, borderRadius: r, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colorSistema.texto2, fontSize: tamano * 0.36, fontWeight: '600' }}>{letras || '•'}</Text>
    </View>
  );
}
