// Gemelo de src/plataforma/fotoConMiniatura.js para el teléfono (2026-11-10).
//
// La web sube la foto del catálogo y además su copia chica
// (product-photos/chicas/<ruta>), que hace con un <canvas>. El teléfono no
// tiene <canvas>: sube la foto como lo hacía antes de ese cambio y no escribe
// la copia chica. No se pierde nada que se viera: quien muestra la foto pide la
// copia chica y, si no existe, cae a la original (apps/clientes/componentes/
// FotoProducto.js). Sin este archivo la app no compilaba, porque
// `src/data/laboratorios.js` lo importa.
import { subirArchivo } from '@nucleo/utils/storageFiles';

export const LADO_MINIATURA = 400;
const BUCKET = 'product-photos';

/** Sube `blob` a `product-photos/<ruta>`; devuelve la URL pública de la foto. */
export async function subirFotoDeCatalogo(ruta, blob) {
    return subirArchivo(BUCKET, ruta, blob, { upsert: true, contentType: 'image/jpeg' });
}
