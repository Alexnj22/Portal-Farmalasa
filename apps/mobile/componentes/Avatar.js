// La cara de una persona: su foto o, si no tiene, sus iniciales — sacadas del
// nombre corto canónico (primer nombre + primer apellido).
//
// Si la foto no carga (firma vencida, sin red), quedan las iniciales: antes
// quedaba un círculo vacío. `memo` porque se pinta en cada fila de listas
// largas (personal, marcas, solicitudes) y sus props casi nunca cambian.
import { memo, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from './Formulario';

function Avatar({ empleado, tamano = 40 }) {
  const foto = empleado?.photo || empleado?.photo_url;
  const [rota, setRota] = useState(null);
  const r = tamano / 2;
  if (foto && rota !== foto) {
    return <Image source={{ uri: foto, cache: 'force-cache' }} onError={() => setRota(foto)}
      style={{ width: tamano, height: tamano, borderRadius: r, backgroundColor: colorSistema.separador }} />;
  }
  const letras = shortEmployeeName(empleado).split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  return (
    <View style={{ width: tamano, height: tamano, borderRadius: r, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colorSistema.texto2, fontSize: tamano * 0.36, fontWeight: '600' }} allowFontScaling={false}>{letras || '•'}</Text>
    </View>
  );
}

export default memo(Avatar);
