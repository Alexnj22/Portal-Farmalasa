// La foto que se le manda al lector de boletas, reducida — la versión del
// teléfono de `src/plataforma/fotoParaLeer.js`. El contrato es el mismo:
// `aBase64Reducido(archivo, { girar })` devuelve el JPEG en base64 SIN el
// prefijo `data:`, con el lado mayor en 1,400 px como máximo (nunca se agranda:
// el lector cobra por píxel y ampliar no lee mejor) y girado un cuarto de
// vuelta cuando se pide, que es lo que arregla un rollo fotografiado atravesado.
//
// En el teléfono el «archivo» es la foto de `componentes/formulario/Fotos`
// (`{ uri, nombre, tipo }`), no un `File`. Un PDF no llega por acá: la cámara y
// la galería sólo dan imágenes.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const LADO_PARA_LEER = 1400;

export async function aBase64Reducido(archivo, { girar = 0 } = {}) {
  const uri = archivo?.uri;
  if (!uri) throw new Error('No hay foto que leer.');
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const lado = Math.max(original.width, original.height);
  const escala = lado > LADO_PARA_LEER ? LADO_PARA_LEER / lado : 1;
  let ctx = ImageManipulator.manipulate(uri);
  if (escala < 1) ctx = ctx.resize({ width: Math.round(original.width * escala), height: Math.round(original.height * escala) });
  if (girar) ctx = ctx.rotate(girar);
  const img = await ctx.renderAsync();
  const r = await img.saveAsync({ base64: true, compress: 0.8, format: SaveFormat.JPEG });
  return r.base64 || '';
}
