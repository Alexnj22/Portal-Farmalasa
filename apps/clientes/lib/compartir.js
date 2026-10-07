// Compartir una oferta (2026-10-07): la hoja del sistema con la FOTO y el
// enlace. Con la foto, Instagram ofrece «Historias»; WhatsApp y Facebook la
// mandan con el texto. El enlace (/o/<id>) abre la oferta en la app o, sin la
// app, una página con la oferta. Lo usan la tarjeta de la lista y el detalle.
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as FS from 'expo-file-system/legacy';

let ocupado = false;

export async function compartirOferta(oferta) {
  if (ocupado || !oferta) return;
  ocupado = true;
  Haptics.selectionAsync().catch(() => {});
  const enlace = `https://portal.farmasalud.lat/o/${oferta.id}`;
  const mensaje = `${oferta.titulo}${oferta.etiqueta ? ` (${oferta.etiqueta})` : ''} en Farmacia Salud. Mírala en la app Puntos Salud: ${enlace}`;
  try {
    let url;
    if (oferta.imagen) {
      const destino = `${FS.cacheDirectory}oferta-${String(oferta.id).replace(/[^\w-]/g, '')}.jpg`;
      url = (await FS.downloadAsync(oferta.imagen, destino)).uri;
    }
    await Share.share(url ? { url, message: mensaje } : { message: mensaje, url: enlace });
  } catch { /* cancelado o sin red */ }
  ocupado = false;
}
