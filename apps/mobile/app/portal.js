import { Stack, useLocalSearchParams } from 'expo-router';
import PortalIncrustado from '../componentes/PortalIncrustado';

export default function Portal() {
  const { ruta = '/inicio' } = useLocalSearchParams();
  // Sin título: la pantalla del portal ya trae el suyo, y repetirlo arriba se
  // lee como dos pantallas. La barra queda para la flecha de regreso.
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <PortalIncrustado ruta={String(ruta)} />
    </>
  );
}
