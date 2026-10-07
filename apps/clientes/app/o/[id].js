// El enlace que se comparte (https://portal.farmasalud.lat/o/<id>): con la app
// instalada, iOS abre esta ruta; acá sólo se pasa a la oferta.
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function OfertaCompartida() {
  const { id } = useLocalSearchParams();
  return <Redirect href={`/oferta/${id}`} />;
}
