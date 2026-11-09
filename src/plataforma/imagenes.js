// ─────────────────────────────────────────────────────────────────────────────
// Achicar una foto antes de subirla o mandarla — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// Hasta el 2026-09-25 esto estaba escrito CUATRO veces, cada una con su propio
// «abrir la imagen, calcular la escala, dibujarla en un lienzo»:
//   · `compressImage` en `employeeSlice` (fotos de empleados, WebP)
//   · `reducirParaMandar` en `data/capturaDesdeElTelefono`
//   · `achicar` en `data/recorteSugerido`
//   · `aBase64Reducido` en `plataforma/fotoParaLeer`
// Las cuatro siguen existiendo con sus mismos parámetros —tope, formato,
// calidad— y dan el mismo resultado byte por byte (enfrentadas en Chrome y en
// Safari); lo que ya no se repite es el cómo. En la app nativa esto se hace con
// el manipulador de imágenes del sistema. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.

/** Abre un `File`/`Blob` de imagen. Rechaza con `mensaje` si no se puede. */
export function abrirImagen(archivo, mensaje = 'No se pudo leer la foto.') {
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(mensaje)); };
        img.src = url;
    });
}

/**
 * Dibuja la imagen reducida en un lienzo nuevo. Nunca la AGRANDA: estirar una
 * foto chica sólo agrega peso y le quita nitidez.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {object} o
 * @param {number} [o.ladoMaximo]   tope del lado MAYOR
 * @param {number} [o.anchoMaximo]  tope del ANCHO (las fotos de empleado)
 * @param {number} [o.girar=0]      grados; con 90/270 el lienzo cambia de forma
 * @param {'low'|'medium'|'high'} [o.suavizado]
 * @param {boolean} [o.redondear=true] tamaño entero (lo que hacían tres de las
 *   cuatro); las fotos de empleado usaban el producto sin redondear.
 */
export function lienzoReducido(img, { ladoMaximo, anchoMaximo, girar = 0, suavizado, redondear = true } = {}) {
    const escala = anchoMaximo != null
        ? (anchoMaximo > img.width ? 1 : anchoMaximo / img.width)
        : Math.min(1, ladoMaximo / Math.max(img.width, img.height));
    const w = redondear ? Math.max(1, Math.round(img.width * escala)) : img.width * escala;
    const h = redondear ? Math.max(1, Math.round(img.height * escala)) : img.height * escala;
    const g = ((girar % 360) + 360) % 360;
    const cuarto = g === 90 || g === 270;
    const c = document.createElement('canvas');
    c.width = cuarto ? h : w;
    c.height = cuarto ? w : h;
    const ctx = c.getContext('2d');
    if (suavizado) ctx.imageSmoothingQuality = suavizado;
    if (girar) {
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((girar * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
        ctx.drawImage(img, 0, 0, c.width, c.height);
    }
    return c;
}

/** Reducida y en JPEG, como `data:` URL completa. */
export async function reducirAJpeg(archivo, { ladoMaximo, calidad, mensaje } = {}) {
    const img = await abrirImagen(archivo, mensaje);
    return lienzoReducido(img, { ladoMaximo }).toDataURL('image/jpeg', calidad);
}

/**
 * La foto de un empleado: 400 px de ANCHO como mucho, en WebP (conserva la
 * transparencia y comprime) al 85 %. Si el navegador no sabe hacer WebP, el
 * lienzo da PNG y el nombre del archivo lo refleja; si no da nada, vuelve el
 * archivo original.
 */
export async function comprimirFotoDeEmpleado(file, maxWidth = 400) {
    const img = await abrirImagen(file);
    const canvas = lienzoReducido(img, { anchoMaximo: maxWidth, redondear: false });
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            const finalType = blob.type || 'image/png';
            const ext = finalType.includes('webp') ? '.webp' : '.png';
            resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '') + ext, {
                type: finalType,
                lastModified: Date.now(),
            }));
        }, 'image/webp', 0.85);
    });
}

/**
 * La foto del catálogo de productos: lado mayor `ladoMaximo`, JPEG, sobre
 * fondo BLANCO (una PNG transparente saldría negra en JPEG). Vivía escrita
 * dentro de la ficha del catálogo; salió el 2026-10-30 porque Fotos de
 * productos sube al mismo bucket y la foto tiene que salir igual.
 */
// El recuadro del producto sin el margen blanco (2026-11-09): en la app, el
// margen dentro del archivo hacía ver chico al producto. Una fila o columna
// cuenta si tiene al menos 4 píxeles oscuros, para no agrandar el recorte por
// una mota suelta. Deja 2 % de aire. Sin nada que recortar, la imagen entera.
function recuadroSinMargen(img) {
    const entera = { x: 0, y: 0, ancho: img.width, alto: img.height };
    const escala = Math.min(1, 400 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * escala));
    const h = Math.max(1, Math.round(img.height * escala));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const filas = new Array(h).fill(0);
    const columnas = new Array(w).fill(0);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 238) { filas[y]++; columnas[x]++; }
        }
    }
    const conProducto = (v) => v >= 4;
    const y0 = filas.findIndex(conProducto);
    const x0 = columnas.findIndex(conProducto);
    if (y0 < 0 || x0 < 0) return entera;
    const y1 = filas.findLastIndex(conProducto) + 1;
    const x1 = columnas.findLastIndex(conProducto) + 1;
    const aire = 0.02 * Math.max(img.width, img.height);
    const x = Math.max(0, x0 / w * img.width - aire);
    const y = Math.max(0, y0 / h * img.height - aire);
    return {
        x, y,
        ancho: Math.min(img.width, x1 / w * img.width + aire) - x,
        alto: Math.min(img.height, y1 / h * img.height + aire) - y,
    };
}

export async function fotoDeCatalogo(archivo, ladoMaximo = 800, calidad = 0.85) {
    const img = await abrirImagen(archivo);
    const r = recuadroSinMargen(img);
    const escala = Math.min(1, ladoMaximo / Math.max(r.ancho, r.alto));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.ancho * escala));
    c.height = Math.max(1, Math.round(r.alto * escala));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, r.x, r.y, r.ancho, r.alto, 0, 0, c.width, c.height);
    return new Promise((resolve, reject) => {
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo preparar la foto.'))), 'image/jpeg', calidad);
    });
}
