/**
 * Afinar las esquinas de un papel contra sus BORDES reales. Puro: sin red ni
 * navegador — recibe la foto en grises y devuelve esquinas.
 *
 * ── Por qué (2026-10-17) ────────────────────────────────────────────────────
 *
 * El modelo devuelve las cuatro esquinas «a ojo»: en la medición del 17-oct
 * cortó el encabezado de un certificado con un tope de pensamiento y, sin
 * tope, sus respuestas varían entre corridas. Lo que sí es exacto en la foto
 * es el borde del papel: donde termina el blanco y empieza la mesa hay un
 * salto de brillo. Este paso busca, cerca de cada lado que propuso el modelo,
 * la recta donde ese salto es más fuerte, y pone cada esquina en el cruce de
 * dos lados vecinos. No cuesta tokens ni red.
 *
 * ── Cuándo NO toca nada ─────────────────────────────────────────────────────
 *
 * Una ayuda que se equivoca es peor que ninguna, así que cada lado se cambia
 * sólo si el borde encontrado es claramente más fuerte que el del modelo (y
 * que el promedio de la foto, para no perseguir ruido), y el
 * resultado entero se descarta si alguna esquina se mueve más de la banda de
 * búsqueda, si el cuadrilátero deja de ser convexo o si su área cambia más de
 * un 15%. En esos casos vuelven las esquinas del modelo, sin cambios.
 */

const GRADOS = Math.PI / 180;

/** Sobel: magnitud del gradiente en x e y. */
function gradientes(gris, ancho, alto) {
    const gx = new Float32Array(ancho * alto);
    const gy = new Float32Array(ancho * alto);
    for (let y = 1; y < alto - 1; y++) {
        for (let x = 1; x < ancho - 1; x++) {
            const i = y * ancho + x;
            const a = gris[i - ancho - 1], b = gris[i - ancho], c = gris[i - ancho + 1];
            const d = gris[i - 1], f = gris[i + 1];
            const g = gris[i + ancho - 1], h = gris[i + ancho], k = gris[i + ancho + 1];
            gx[i] = (c + 2 * f + k) - (a + 2 * d + g);
            gy[i] = (g + 2 * h + k) - (a + 2 * b + c);
        }
    }
    return { gx, gy };
}

/** Cuánto «borde» hay a lo largo de una recta: el gradiente en su normal. */
function puntaje(g, ancho, alto, cx, cy, dx, dy, largo) {
    const nx = -dy, ny = dx;
    let suma = 0, n = 0;
    const MUESTRAS = 48;
    for (let s = 0; s < MUESTRAS; s++) {
        // Del 15% al 85% del lado: cerca de las esquinas el borde se curva
        // (carnés con puntas redondeadas) y suele haber un dedo o una sombra.
        const t = (0.15 + 0.7 * s / (MUESTRAS - 1) - 0.5) * largo;
        const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t);
        if (x < 1 || y < 1 || x >= ancho - 1 || y >= alto - 1) continue;
        const i = y * ancho + x;
        suma += Math.abs(g.gx[i] * nx + g.gy[i] * ny);
        n++;
    }
    return n >= MUESTRAS / 2 ? suma / n : 0;
}

function cruce(a, b) {
    // Recta = punto (cx,cy) + dirección (dx,dy).
    const det = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(det) < 1e-6) return null;
    const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / det;
    return { x: a.cx + a.dx * t, y: a.cy + a.dy * t };
}

const areaDe = (p) => Math.abs(p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a.x * b.y - b.x * a.y;
}, 0)) / 2;

function convexo(p) {
    let signo = 0;
    for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
        const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(z) < 1e-9) return false;
        if (signo === 0) signo = Math.sign(z);
        else if (Math.sign(z) !== signo) return false;
    }
    return true;
}

/**
 * @param {ArrayLike<number>} gris  brillo 0-255, fila por fila
 * @param {number} ancho
 * @param {number} alto
 * @param {{x:number,y:number}[]} esquinas  ORDENADAS (arriba-izq, arriba-der,
 *   abajo-der, abajo-izq), en fracciones de la foto
 * @param {{banda?: number, grados?: number, mejora?: number}} [opciones]
 * @returns {{ esquinas: {x:number,y:number}[], ladosAfinados: number,
 *             movimiento: number, motivo: string|null }}
 *   `movimiento` = cuánto se movió la esquina que más se movió, en fracción
 *   del lado mayor de la foto.
 */
export function afinarEsquinas(gris, ancho, alto, esquinas, opciones = {}) {
    const sinCambios = (motivo) => ({ esquinas, ladosAfinados: 0, movimiento: 0, motivo });
    if (!gris || !ancho || !alto || esquinas?.length !== 4) return sinCambios('sin datos');

    const lado = Math.max(ancho, alto);
    const banda = Math.max(3, Math.round((opciones.banda ?? 0.04) * lado));
    const maxGrados = opciones.grados ?? 5;
    const mejora = opciones.mejora ?? 1.15;
    const g = gradientes(gris, ancho, alto);
    const pts = esquinas.map(p => ({ x: p.x * ancho, y: p.y * alto }));

    /* El piso: un borde de papel contra mesa es mucho más fuerte que el
     * promedio de la foto. Sin esto, en una foto sin bordes claros el ruido
     * «ganaba» y las esquinas se movían hacia nada. */
    let total = 0, cuenta = 0;
    for (let i = 0; i < g.gx.length; i += 7) { total += Math.abs(g.gx[i]) + Math.abs(g.gy[i]); cuenta++; }
    const piso = 4 * (total / Math.max(1, cuenta));

    const rectas = [];
    let ladosAfinados = 0;
    for (let i = 0; i < 4; i++) {
        const p = pts[i], q = pts[(i + 1) % 4];
        const largo = Math.hypot(q.x - p.x, q.y - p.y);
        if (largo < 10) return sinCambios('lado demasiado corto');
        const dx0 = (q.x - p.x) / largo, dy0 = (q.y - p.y) / largo;
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const base = { cx: mx, cy: my, dx: dx0, dy: dy0 };
        const puntajeBase = puntaje(g, ancho, alto, mx, my, dx0, dy0, largo);

        let mejor = { ...base, s: puntajeBase };
        for (let a = -maxGrados; a <= maxGrados; a += 0.5) {
            const cos = Math.cos(a * GRADOS), sin = Math.sin(a * GRADOS);
            const dx = dx0 * cos - dy0 * sin, dy = dx0 * sin + dy0 * cos;
            const nx = -dy, ny = dx;
            for (let o = -banda; o <= banda; o++) {
                const cx = mx + nx * o, cy = my + ny * o;
                const s = puntaje(g, ancho, alto, cx, cy, dx, dy, largo);
                if (s > mejor.s) mejor = { cx, cy, dx, dy, s };
            }
        }
        if (mejor.s > puntajeBase * mejora && mejor.s > piso) {
            rectas.push(mejor);
            ladosAfinados++;
        } else {
            rectas.push(base);
        }
    }
    if (!ladosAfinados) return sinCambios('ningún borde más claro que el propuesto');

    // Esquina i = cruce del lado anterior (i-1) con el lado i.
    const nuevas = [];
    for (let i = 0; i < 4; i++) {
        const c = cruce(rectas[(i + 3) % 4], rectas[i]);
        if (!c) return sinCambios('lados paralelos');
        nuevas.push(c);
    }

    let movimiento = 0;
    for (let i = 0; i < 4; i++) {
        movimiento = Math.max(movimiento, Math.hypot(nuevas[i].x - pts[i].x, nuevas[i].y - pts[i].y));
    }
    if (movimiento > banda * 1.5) return sinCambios('se movía demasiado');
    if (!convexo(nuevas)) return sinCambios('quedaba torcido');
    const razon = areaDe(nuevas) / areaDe(pts);
    if (razon < 0.85 || razon > 1.15) return sinCambios('cambiaba demasiado el tamaño');

    return {
        esquinas: nuevas.map(p => ({
            x: Math.min(1, Math.max(0, p.x / ancho)),
            y: Math.min(1, Math.max(0, p.y / alto)),
        })),
        ladosAfinados,
        movimiento: movimiento / lado,
        motivo: null,
    };
}
