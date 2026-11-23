// La copia chica de una foto del catálogo, con la convención del portal
// (src/plataforma/fotoConMiniatura.js): `product-photos/chicas/<ruta>`, 400 px
// de lado mayor, JPEG 0.8.
//
// 2026-11-23: el portal y las dos apps pintan las miniaturas con esa copia. La
// app del personal subía sólo la grande, así que si la foto no se recortaba
// (`recortar-foto-producto` deja `<id>.jpg` tal cual cuando no hay margen) la
// copia chica quedaba la de la foto anterior. Un fallo acá NO frena el
// guardado: la foto grande ya subió y, si falta la chica, se cae a la grande.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { subirArchivo } from '@nucleo/utils/storageFiles';

const LADO_CHICA = 400;

export async function subirFotoChica(uri, ruta) {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: LADO_CHICA }).renderAsync();
    const hecha = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    const datos = await (await fetch(hecha.uri)).arrayBuffer();
    await subirArchivo('product-photos', `chicas/${ruta}`, datos, { upsert: true, contentType: 'image/jpeg' });
  } catch (e) {
    console.warn('[fotoChica] la foto subió, la copia chica no:', e);
  }
}
