// Medir y encuadrar la foto de un producto, con un lienzo (2026-10-30).
// La decisión de qué es «muy pequeña» vive en `utils/calidadDeFoto.js`; acá
// sólo se mide y se dibuja.

function cargar(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => (img.naturalWidth && img.naturalHeight ? resolve(img) : reject(new Error('vacia')));
        img.onerror = () => reject(new Error('ilegible'));
        img.src = src;
    });
}

/**
 * `{ ancho, alto, nitidez, contraste }` de la imagen. Nitidez = varianza del
 * laplaciano sobre la imagen reducida a 256 px de lado mayor (así el número no
 * depende del tamaño); contraste = desviación estándar del brillo.
 * Lanza `Error('ilegible')` si el navegador no la puede abrir.
 */
export async function medirFoto(src) {
    const img = await cargar(src);
    const escala = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(3, Math.round(img.naturalWidth * escala));
    const h = Math.max(3, Math.round(img.naturalHeight * escala));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const gris = new Float32Array(w * h);
    let suma = 0;
    for (let i = 0; i < w * h; i++) {
        gris[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        suma += gris[i];
    }
    const media = suma / (w * h);
    let var0 = 0;
    for (let i = 0; i < w * h; i++) var0 += (gris[i] - media) ** 2;
    // Laplaciano 4-vecinos. Las zonas planas (el fondo blanco) dan 0 y bajan el
    // promedio aunque el producto esté nítido: se mide sólo donde hay detalle.
    const lap = [];
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const v = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - w] - gris[i + w];
            const local = Math.abs(gris[i] - gris[i - 1]) + Math.abs(gris[i] - gris[i - w]);
            if (local > 2 || Math.abs(v) > 2) lap.push(v);
        }
    }
    let nitidez = null;
    if (lap.length > 50) {
        const m = lap.reduce((a, b) => a + b, 0) / lap.length;
        nitidez = lap.reduce((a, b) => a + (b - m) ** 2, 0) / lap.length;
    }
    // ¿El fondo ya es blanco? (borde claro y parejo: la típica foto de catálogo)
    const borde = [];
    for (let x = 0; x < w; x++) borde.push(gris[x], gris[(h - 1) * w + x]);
    for (let y = 0; y < h; y++) borde.push(gris[y * w], gris[y * w + w - 1]);
    const mb = borde.reduce((a, b) => a + b, 0) / borde.length;
    const db = Math.sqrt(borde.reduce((a, b) => a + (b - mb) ** 2, 0) / borde.length);
    return {
        ancho: img.naturalWidth, alto: img.naturalHeight, nitidez,
        contraste: Math.sqrt(var0 / (w * h)),
        fondoBlanco: mb > 235 && db < 10,
    };
}

/**
 * Recorta el producto y lo centra en un cuadrado con margen parejo: todas las
 * fotos del catálogo quedan del mismo tamaño aparente en la app.
 *
 * Si la imagen tiene transparencia (ya se le quitó el fondo) el producto es lo
 * opaco; si no, es lo que se distingue del color de los bordes — que en una
 * foto de catálogo bajada de internet casi siempre es blanco. Devuelve un
 * `blob:` PNG (conserva la transparencia para poder seguir retocando), o
 * `null` si no encontró un producto que recortar.
 */
export async function encuadrarProducto(src, { margen = 0.08, ladoMaximo = 1600 } = {}) {
    const img = await cargar(src);
    const escala = Math.min(1, ladoMaximo / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * escala);
    const h = Math.round(img.naturalHeight * escala);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;

    let conAlfa = false;
    for (let i = 3; i < d.length; i += 4 * 7) { if (d[i] < 250) { conAlfa = true; break; } }

    // Color de fondo: la mediana de los píxeles del borde.
    const borde = [];
    for (let x = 0; x < w; x += 2) { borde.push(x * 4, ((h - 1) * w + x) * 4); }
    for (let y = 0; y < h; y += 2) { borde.push(y * w * 4, (y * w + w - 1) * 4); }
    const mediana = (k) => { const v = borde.map((i) => d[i + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const fondo = [mediana(0), mediana(1), mediana(2)];

    const esProducto = (i) => (conAlfa
        ? d[i + 3] > 24
        : Math.abs(d[i] - fondo[0]) + Math.abs(d[i + 1] - fondo[1]) + Math.abs(d[i + 2] - fondo[2]) > 48);

    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (esProducto((y * w + x) * 4)) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // Un «producto» que ocupa casi toda la imagen es una foto sin fondo
    // distinguible (una mesa, una mano): recortarla no mejora nada.
    if (!conAlfa && bw * bh > 0.97 * w * h) return null;

    const lado = Math.round(Math.max(bw, bh) / (1 - 2 * margen));
    const out = document.createElement('canvas');
    out.width = lado; out.height = lado;
    const octx = out.getContext('2d');
    if (!conAlfa) {
        octx.fillStyle = `rgb(${fondo[0]},${fondo[1]},${fondo[2]})`;
        octx.fillRect(0, 0, lado, lado);
    }
    octx.drawImage(c, x0, y0, bw, bh, Math.round((lado - bw) / 2), Math.round((lado - bh) / 2), bw, bh);
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
}
