// La firma dibujada en pantalla, convertida en imagen para guardarla (2026-11-13).
//
// Se guarda como TINTA NEGRA sobre fondo transparente, sin importar el tema: es
// papel, no pantalla — la misma firma se imprime en el expediente y se tiene
// que ver igual en claro y en oscuro. Por eso el color es un literal y no un
// token (excepción declarada en `scripts/design-gate.mjs`).
//
// Los trazos llegan en coordenadas del lienzo (px CSS). Se reescalan a un
// ancho máximo para que la imagen pese pocos KB (la base acepta hasta 200 KB).

const TINTA = '#000000';
const ANCHO_MAX = 600;

/**
 * @param {Array<Array<{x:number,y:number}>>} trazos
 * @param {{ancho:number, alto:number}} lienzo tamaño del lienzo en px CSS
 * @returns {string|null} `data:image/png;base64,…`, o null si no hay trazos
 */
export function firmaComoImagen(trazos, { ancho, alto }) {
    const conPuntos = (trazos || []).filter((t) => t.length > 0);
    if (!conPuntos.length || !ancho || !alto) return null;
    const escala = Math.min(1, ANCHO_MAX / ancho);
    const cv = document.createElement('canvas');
    cv.width = Math.round(ancho * escala);
    cv.height = Math.round(alto * escala);
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = TINTA;
    ctx.fillStyle = TINTA;
    ctx.lineWidth = Math.max(1.5, 2.5 * escala);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of conPuntos) {
        if (t.length === 1) {
            ctx.beginPath();
            ctx.arc(t[0].x * escala, t[0].y * escala, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.beginPath();
        ctx.moveTo(t[0].x * escala, t[0].y * escala);
        for (const p of t.slice(1)) ctx.lineTo(p.x * escala, p.y * escala);
        ctx.stroke();
    }
    return cv.toDataURL('image/png');
}
