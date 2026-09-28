import { Stack, useLocalSearchParams } from 'expo-router';
import PortalIncrustado from '../componentes/PortalIncrustado';

export default function Portal() {
  const { ruta = '/inicio', nombre } = useLocalSearchParams();
  return (
    <>
      <Stack.Screen options={{ title: nombre || 'Portal' }} />
      <PortalIncrustado ruta={String(ruta)} />
    </>
  );
}
