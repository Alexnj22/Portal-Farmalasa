/**
 * Preparación de fotos y videos en el teléfono, antes de subirlos:
 *   · la foto se reduce (12 MB → ~400 KB) y se corrige la orientación
 *     (createImageBitmap respeta el EXIF);
 *   · un HEIC que el navegador no sabe leer (Chrome en Android, Windows) se
 *     convierte a JPG con heic2any, que se descarga SÓLO si hace falta;
 *   · de cada archivo sale además una miniatura de ~480 px: el álbum y el
 *     mosaico muestran ésa, y la grande sólo se baja al abrir la foto.
 */

const esHeic = (file) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');

let heicPromise = null;
function getHeic2any() {
  if (!heicPromise) {
    heicPromise = import('heic2any')
      .then((m) => m.default || m)
      .catch((err) => { heicPromise = null; throw err; });
  }
  return heicPromise;
}

async function abrirBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!esHeic(file)) throw err;
    const heic2any = await getHeic2any();
    const r = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return createImageBitmap(Array.isArray(r) ? r[0] : r, { imageOrientation: 'from-image' });
  }
}

function aJpg(fuente, anchoOrig, altoOrig, maxLado, calidad) {
  const escala = Math.min(1, maxLado / Math.max(anchoOrig, altoOrig));
  const ancho = Math.round(anchoOrig * escala);
  const alto = Math.round(altoOrig * escala);
  const canvas = document.createElement('canvas');
  canvas.width = ancho; canvas.height = alto;
  canvas.getContext('2d').drawImage(fuente, 0, 0, ancho, alto);
  return new Promise((r) => canvas.toBlob((b) => r({ blob: b, ancho, alto }), 'image/jpeg', calidad));
}

/**
 * Foto lista para subir: { blob, tipo, ext, ancho, alto, miniatura }.
 * Si no se puede leer de ninguna forma se sube el original con su tipo REAL
 * (antes se marcaba como .jpg y el archivo quedaba roto).
 */
export async function prepararFoto(file, { maxLado = 2000, calidad = 0.82, miniLado = 480 } = {}) {
  let bmp;
  try {
    bmp = await abrirBitmap(file);
  } catch {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
    return { blob: file, tipo: file.type || 'application/octet-stream', ext, ancho: null, alto: null, miniatura: null };
  }
  const grande = await aJpg(bmp, bmp.width, bmp.height, maxLado, calidad);
  const mini = await aJpg(bmp, bmp.width, bmp.height, miniLado, 0.75);
  bmp.close?.();
  if (!grande.blob) return { blob: file, tipo: file.type, ext: 'jpg', ancho: null, alto: null, miniatura: null };
  return { blob: grande.blob, tipo: 'image/jpeg', ext: 'jpg', ancho: grande.ancho, alto: grande.alto, miniatura: mini.blob };
}

/** Compatibilidad con el modo demo: sólo la foto reducida. */
export async function comprimirImagen(file, maxLado = 2000, calidad = 0.82) {
  const r = await prepararFoto(file, { maxLado, calidad });
  return { blob: r.blob, ancho: r.ancho, alto: r.alto };
}

/** Portada de un video (un cuadro del primer segundo) + sus medidas. Nunca lanza. */
export function portadaDeVideo(file, miniLado = 480) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let listo = false;
    const fin = (r) => { if (listo) return; listo = true; URL.revokeObjectURL(url); resolve(r); };
    const plazo = setTimeout(() => fin({ miniatura: null, ancho: null, alto: null }), 8000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = async () => {
      clearTimeout(plazo);
      try {
        const r = await aJpg(v, v.videoWidth, v.videoHeight, miniLado, 0.75);
        fin({ miniatura: r.blob, ancho: v.videoWidth || null, alto: v.videoHeight || null });
      } catch { fin({ miniatura: null, ancho: null, alto: null }); }
    };
    v.onerror = () => { clearTimeout(plazo); fin({ miniatura: null, ancho: null, alto: null }); };
    v.src = url;
  });
}

export const blobADataUrl = (blob) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
