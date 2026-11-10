/**
 * Reduce una foto del teléfono antes de subirla (12 MB → ~400 KB) y corrige la
 * orientación (createImageBitmap respeta el EXIF). Devuelve { blob, ancho, alto }.
 */
export async function comprimirImagen(file, maxLado = 2000, calidad = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // HEIC en navegadores que no lo decodifican: se sube tal cual.
    return { blob: file, ancho: null, alto: null };
  }
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const ancho = Math.round(bmp.width * escala);
  const alto = Math.round(bmp.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = ancho; canvas.height = alto;
  canvas.getContext('2d').drawImage(bmp, 0, 0, ancho, alto);
  bmp.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', calidad));
  return { blob: blob || file, ancho, alto };
}

export const blobADataUrl = (blob) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
