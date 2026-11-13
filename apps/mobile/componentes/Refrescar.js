// «Jalar para actualizar». Misma firma que el `RefreshControl` de React Native
// (2026-11-13, «TODO debe ser material nuevo en android»):
//   · iPhone: el nativo de iOS (UIRefreshControl), sin tocar.
//   · Android: el de la plataforma viene gris sobre blanco, el del Material
//     viejo. Se le ponen los colores de Material 3 — el indicador en el
//     primario sobre el contenedor tonal — sacados de la paleta del sistema
//     leída en vivo (tema/material.js).
import { Platform, RefreshControl } from 'react-native';
import { usePaleta } from '../tema/material';

export default function Refrescar(props) {
  const paleta = usePaleta();
  if (Platform.OS !== 'android' || !paleta) return <RefreshControl {...props} />;
  return (
    <RefreshControl colors={[paleta.primary]} progressBackgroundColor={paleta.surfaceContainerHigh} {...props} />
  );
}
