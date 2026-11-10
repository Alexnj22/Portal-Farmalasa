// ─────────────────────────────────────────────────────────────────────────────
// Subir una foto del catálogo CON su copia chica, hecha una sola vez acá.
// ─────────────────────────────────────────────────────────────────────────────
//
// 2026-11-10: la app de clientes pedía cada miniatura al servidor de imágenes
// del almacenamiento (`/render/image/…?height=…`), que cobra por cada foto
// distinta que achica en el mes. El plan Pro trae 100 y se llegó a 208 con el
// tope de gasto encendido: Supabase puede empezar a negarlas.
//
// Ahora la copia chica se hace UNA vez, al subir, y se guarda al lado:
//   product-photos/<ruta>          la foto (como siempre)
//   product-photos/chicas/<ruta>   la misma, a 400 px de lado mayor
// La app la pide por esa convención (apps/clientes/componentes/FotoProducto.js)
// y, si no existe, cae a la original. Por eso un fallo acá NO frena el guardado:
// la foto ya subió y en el peor caso se ve como antes.
//
// Las fotos que ya estaban se completaron con `scripts/miniaturas-catalogo.py`.
// La función `recortar-foto-producto` escribe la suya con la misma convención.
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { abrirImagen, lienzoReducido } from './imagenes';

export const LADO_MINIATURA = 400;
const BUCKET = 'product-photos';

async function miniatura(blob) {
    const img = await abrirImagen(blob);
    const c = lienzoReducido(img, { ladoMaximo: LADO_MINIATURA, suavizado: 'high' });
    return new Promise((res, rej) => c.toBlob(
        (b) => (b ? res(b) : rej(new Error('No se pudo preparar la miniatura.'))), 'image/jpeg', 0.8));
}

/** Sube `blob` a `product-photos/<ruta>` y su copia chica; devuelve la URL pública de la foto. */
export async function subirFotoDeCatalogo(ruta, blob) {
    const url = await subirArchivo(BUCKET, ruta, blob, { upsert: true, contentType: 'image/jpeg' });
    try {
        await subirArchivo(BUCKET, `chicas/${ruta}`, await miniatura(blob), { upsert: true, contentType: 'image/jpeg' });
    } catch (err) {
        console.warn('[fotoConMiniatura] la foto subió, la miniatura no:', err);
    }
    return url;
}
