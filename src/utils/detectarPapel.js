/**
 * Dónde está el papel dentro de la foto, mirando los PÍXELES.
 *
 * ── Por qué no lo contesta el modelo ────────────────────────────────────────
 *
 * Porque se midió y no lo hace bien. El 2026-08-29 se le pasó una foto
 * sintética de una factura sobre una mesa —las esquinas verdaderas se conocen
 * porque la foto la dibujamos nosotros, así el error se mide en vez de
 * opinarse— y contestó, en las dos versiones del prompt:
 *
 *  · pidiéndole primero el recuadro: las cuatro esquinas DE LA CAJA, o sea un
 *    rectángulo casi perfecto sobre un papel claramente en trapecio;
 *  · pidiéndole sólo las esquinas: un trapecio, pero inclinado al REVÉS que el
 *    papel, con 10% a 15% de desvío en cada una de las cuatro.
 *
 * Un 13% del ancho son 150 px en una foto de 1200: no es «casi». Enderezar con
 * eso deja el documento torcido y con mesa adentro, que es exactamente lo que
 * se reportó desde la sala.
 *
 * Y esto es geometría, no lectura: dónde termina el blanco del papel y empieza
 * la mesa es una pregunta que los píxeles contestan solos. Hacerlo acá además
 * sale gratis, es instantáneo, funciona sin señal y no necesita permiso — que
 * en el teléfono, donde la página del QR se abre sin sesión, no es un detalle.
 *
 * El modelo queda como RESPALDO: sirve cuando el papel no contrasta con el
 * fondo (una hoja blanca sobre un escritorio blanco), que es justo donde un
 * umbral no puede decidir.
 *
 * ── Cómo ───────────────────────────────────────────────────────────────────
 *
 * Achicar → gris → umbral de Otsu → la mancha clara más grande → su casco
 * convexo → el cuadrilátero de mayor área dentro de ese casco. Es lo que hace
 * cualquier escáner de documentos, y cada paso se puede mirar por separado.
 */

/** Lado mayor al que se achica para mirar. Más no mejora y cuesta. */
const LADO = 480;

/** Qué parte de la foto tiene que ocupar el papel para creerle al hallazgo. */
const AREA_MINIMA = 0.10;
const AREA_MAXIMA = 0.995;

/* Cuánto tienen que diferenciarse los dos grupos de Otsu, en niveles de gris.
 *
 * Otsu SIEMPRE parte la imagen en dos, haya o no algo que partir: sobre una
 * foto de pura mesa de madera separa la veta clara de la oscura y devuelve una
 * mancha perfectamente creíble. Sin esta reja, el detector recortaba un papel
 * inexistente — medido, y es el peor de los errores posibles porque el archivo
 * queda adjunto y recortado sin que nadie haya pedido nada.
 *
 * El número sale de medir, no de elegirlo. Sobre siete fotos con la verdad
 * conocida (2026-08-29):
 *
 *   sin papel, mesa oscura ...........   6   ← hay que rechazar
 *   sin papel, mesa clara ............  14   ← hay que rechazar
 *   papel gris sobre mesa gris .......  31   ← lo encuentra MAL (25.6% de desvío)
 *   papel blanco, escritorio claro ...  59   ← bien (0.9%)
 *   papel blanco, gris medio .........  98   ← bien
 *   papel claro, mesa oscura ......... 163   ← bien
 *   de costado, mesa negra ........... 186   ← bien
 *
 * O sea que el corte tiene lugar de sobra entre 31 y 59. Y lo que queda del
 * lado de afuera no se pierde: cae al modelo, que es exactamente el caso para
 * el que sirve —cuando el papel no contrasta, los píxeles no pueden decidir—.
 */
const SEPARACION_MINIMA = 45;

/** La foto en gris, ya achicada. */
function enGris(imagen) {
    const w0 = imagen.naturalWidth || imagen.width;
    const h0 = imagen.naturalHeight || imagen.height;
    if (!w0 || !h0) return null;
    const escala = Math.min(1, LADO / Math.max(w0, h0));
    const w = Math.max(8, Math.round(w0 * escala));
    const h = Math.max(8, Math.round(h0 * escala));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imagen, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const gris = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
        gris[i] = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    }
    return { gris, w, h };
}

/**
 * El umbral que mejor separa la imagen en dos, por el método de Otsu.
 *
 * Es el que maximiza la varianza ENTRE los dos grupos, o sea el que los deja
 * más distintos posible. No hay que elegir un número a mano, que es lo que lo
 * hace sobrevivir a una foto oscura y a una con flash.
 */
function umbralDeOtsu(gris) {
    const hist = new Int32Array(256);
    for (let i = 0; i < gris.length; i++) hist[gris[i]]++;
    const total = gris.length;
    let suma = 0;
    for (let t = 0; t < 256; t++) suma += t * hist[t];
    let sumaB = 0, pesoB = 0, mejor = 0, mejorVar = -1, separacion = 0;
    for (let t = 0; t < 256; t++) {
        pesoB += hist[t];
        if (!pesoB) continue;
        const pesoF = total - pesoB;
        if (!pesoF) break;
        sumaB += t * hist[t];
        const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
        const entre = pesoB * pesoF * (mB - mF) * (mB - mF);
        if (entre > mejorVar) { mejorVar = entre; mejor = t; separacion = mF - mB; }
    }
    // La separación entre las medias de los dos grupos es la que dice si había
    // DOS cosas en la foto o una sola: ver `SEPARACION_MINIMA`.
    return { umbral: mejor, separacion };
}

/**
 * La mancha clara más grande y conexa. Devuelve sus píxeles de BORDE.
 *
 * Sólo el borde porque es lo único que necesita el casco convexo, y son dos
 * órdenes de magnitud menos puntos que el relleno.
 */
function manchaMasGrande(gris, w, h, umbral) {
    const claro = new Uint8Array(w * h);
    for (let i = 0; i < claro.length; i++) claro[i] = gris[i] > umbral ? 1 : 0;

    const etiqueta = new Int32Array(w * h).fill(-1);
    const cola = new Int32Array(w * h);
    let mejorArea = 0, mejorEtiqueta = -1, n = 0;

    for (let s = 0; s < claro.length; s++) {
        if (!claro[s] || etiqueta[s] !== -1) continue;
        let ini = 0, fin = 0, area = 0;
        cola[fin++] = s; etiqueta[s] = n;
        while (ini < fin) {
            const p = cola[ini++]; area++;
            const x = p % w, y = (p - x) / w;
            // Cuatro vecinos: en diagonal, dos manchas que sólo se tocan por una
            // esquina se unirían, y eso pega el papel a un reflejo de la mesa.
            if (x > 0     && claro[p - 1] && etiqueta[p - 1] === -1) { etiqueta[p - 1] = n; cola[fin++] = p - 1; }
            if (x < w - 1 && claro[p + 1] && etiqueta[p + 1] === -1) { etiqueta[p + 1] = n; cola[fin++] = p + 1; }
            if (y > 0     && claro[p - w] && etiqueta[p - w] === -1) { etiqueta[p - w] = n; cola[fin++] = p - w; }
            if (y < h - 1 && claro[p + w] && etiqueta[p + w] === -1) { etiqueta[p + w] = n; cola[fin++] = p + w; }
        }
        if (area > mejorArea) { mejorArea = area; mejorEtiqueta = n; }
        n++;
    }
    if (mejorEtiqueta < 0) return null;

    const borde = [];
    for (let p = 0; p < etiqueta.length; p++) {
        if (etiqueta[p] !== mejorEtiqueta) continue;
        const x = p % w, y = (p - x) / w;
        const dentro = (q) => etiqueta[q] === mejorEtiqueta;
        // Un píxel del borde de la foto también es borde de la mancha: sin esto,
        // un papel que sale cortado no tiene contorno de ese lado.
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1
            || !dentro(p - 1) || !dentro(p + 1) || !dentro(p - w) || !dentro(p + w)) {
            borde.push({ x, y });
        }
    }
    return { borde, area: mejorArea };
}

/** Casco convexo por barrido de Andrew. Devuelve los puntos en sentido horario. */
function cascoConvexo(pts) {
    if (pts.length < 3) return pts.slice();
    const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const cruz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const media = (arr) => {
        const r = [];
        for (const q of arr) {
            while (r.length >= 2 && cruz(r[r.length - 2], r[r.length - 1], q) <= 0) r.pop();
            r.push(q);
        }
        r.pop();
        return r;
    };
    return media(p).concat(media(p.slice().reverse()));
}

/** El área de un polígono, por la fórmula del cordón. */
function area(poli) {
    let s = 0;
    for (let i = 0, n = poli.length; i < n; i++) {
        const a = poli[i], b = poli[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}

/**
 * Los cuatro puntos del casco que encierran más área.
 *
 * El casco ya viene ordenado, así que basta con elegir cuatro índices
 * crecientes — no hay que probar permutaciones. Y para que no explote con un
 * casco de cientos de puntos, primero se lo adelgaza quedándose con los que más
 * área aportan.
 */
function mejorCuadrilatero(casco) {
    let c = casco;
    const TOPE = 40;
    while (c.length > TOPE) {
        // Se cae el punto cuyo triángulo con sus vecinos es más chico: es el que
        // menos cambia la forma.
        let peor = 0, peorArea = Infinity;
        for (let i = 0; i < c.length; i++) {
            const a = c[(i - 1 + c.length) % c.length], b = c[i], d = c[(i + 1) % c.length];
            const t = Math.abs((b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y)) / 2;
            if (t < peorArea) { peorArea = t; peor = i; }
        }
        c = c.filter((_, i) => i !== peor);
    }
    if (c.length < 4) return null;

    let mejor = null, mejorArea = -1;
    const n = c.length;
    for (let i = 0; i < n - 3; i++)
        for (let j = i + 1; j < n - 2; j++)
            for (let k = j + 1; k < n - 1; k++)
                for (let l = k + 1; l < n; l++) {
                    const q = [c[i], c[j], c[k], c[l]];
                    const a = area(q);
                    if (a > mejorArea) { mejorArea = a; mejor = q; }
                }
    return mejor;
}

/**
 * Las cuatro esquinas del papel, en fracciones de 0 a 1, o `null`.
 *
 * `null` significa «acá no se puede decidir mirando los píxeles» — un papel sin
 * contraste contra el fondo, o una mancha que ocupa toda la foto o casi nada—.
 * Nunca significa «no hay papel»: eso lo decide quien llama, que tiene el
 * respaldo del modelo.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} imagen
 * @returns {{x:number,y:number}[]|null}  en el orden del casco, SIN ordenar
 */
export function detectarPapel(imagen) {
    try {
        const g = enGris(imagen);
        if (!g) return null;
        const { gris, w, h } = g;

        const { umbral, separacion } = umbralDeOtsu(gris);
        if (separacion < SEPARACION_MINIMA) return null;

        const mancha = manchaMasGrande(gris, w, h, umbral);
        if (!mancha) return null;

        const proporcion = mancha.area / (w * h);
        if (proporcion < AREA_MINIMA || proporcion > AREA_MAXIMA) return null;

        const casco = cascoConvexo(mancha.borde);
        const quad = mejorCuadrilatero(casco);
        if (!quad) return null;

        // El cuadrilátero tiene que explicar la mancha: si le sobra mucha área,
        // no es un papel sino una forma cualquiera que quedó clara.
        if (area(quad) < mancha.area * 0.80) return null;

        const puntos = quad.map(p => ({ x: p.x / (w - 1), y: p.y / (h - 1) }));

        /* El cuadro entero NO es una respuesta.
         *
         * Cuando el papel casi no contrasta con la mesa, Otsu no parte por el
         * borde del papel sino por el TEXTO: la mancha clara se come el papel y
         * la mesa juntos, y las cuatro esquinas salen las de la foto. Medido con
         * una hoja gris sobre un escritorio gris — devolvía (0,0)-(1,1) con la
         * hoja de verdad adentro, 23% a 26% de desvío.
         *
         * Y como respuesta no dice nada: rectificar por las esquinas de la foto
         * es no recortar. Así que devolver `null` no pierde información, y en
         * cambio deja que conteste el modelo, que es justamente el caso donde
         * sirve. Vale también cuando el papel SÍ llena el cuadro: ahí las dos
         * respuestas son la misma imagen. */
        const PEGADO = 0.02;
        const enElBorde = puntos.every(p =>
            (p.x < PEGADO || p.x > 1 - PEGADO) && (p.y < PEGADO || p.y > 1 - PEGADO));
        if (enElBorde) return null;

        return puntos;
    } catch {
        // Una ayuda que se cae no puede impedir adjuntar un papel.
        return null;
    }
}
