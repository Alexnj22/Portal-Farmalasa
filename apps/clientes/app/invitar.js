// Invitar a un amigo (2026-10-06) se quitó el 2026-10-24: ni el reglamento v1
// ni el v2 lo tienen («lo que la app promete y el reglamento no tiene se
// quita»). La ruta queda para que un enlace viejo no abra una pantalla rota:
// lleva a Mis puntos.
import { Redirect } from 'expo-router';

export default function Invitar() {
  return <Redirect href="/puntos" />;
}
