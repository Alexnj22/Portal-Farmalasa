/*
 * Fotos del config en el tamaño justo. Las de Unsplash (y cualquier servicio
 * que acepte ?w=) se piden en varios anchos con `auto=format` (AVIF/WebP si el
 * teléfono los entiende): un iPhone baja la de 960 px, no la de 1800.
 * Una foto propia (/fotos/…) se usa tal cual.
 */
export const ANCHOS_PORTADA = [640, 960, 1400, 1800];
export const ANCHOS_GALERIA = [480, 800, 1200];

const acepta = (url) => /^https:\/\/images\.unsplash\.com\//.test(url || '');

export function conAncho(url, w, calidad = 72) {
  if (!acepta(url)) return url;
  const u = new URL(url);
  u.searchParams.set('w', String(w));
  u.searchParams.set('q', String(calidad));
  u.searchParams.set('auto', 'format');
  u.searchParams.delete('h');
  u.searchParams.set('fit', 'max');
  return u.toString();
}

/** { src, srcSet, sizes } para un <img>. */
export function imagenAdaptable(url, anchos = ANCHOS_PORTADA, sizes = '100vw') {
  if (!acepta(url)) return { src: url };
  return {
    src: conAncho(url, anchos[Math.min(1, anchos.length - 1)]),
    srcSet: anchos.map((w) => `${conAncho(url, w)} ${w}w`).join(', '),
    sizes,
  };
}
