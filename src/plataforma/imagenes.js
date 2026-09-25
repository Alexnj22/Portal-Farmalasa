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
 * @param {HTMLImageElement} img
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
