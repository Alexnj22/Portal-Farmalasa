/**
 * Rectificar la perspectiva de un documento fotografiado de costado.
 *
 * ── Qué problema resuelve, y cuál NO ───────────────────────────────────────
 *
 * Recortar y girar arreglan el encuadre. No arreglan que un papel apoyado en un
 * mostrador salga como un TRAPECIO: el borde de arriba más corto que el de
 * abajo, los lados convergiendo. Eso no es un giro — ningún ángulo lo corrige —
 * y es lo que hace que la letra de un extremo quede más chica que la del otro.
 *
 * Acá se deshace: dadas las cuatro esquinas del papel en la foto, se calcula la
 * transformación que las manda a las cuatro esquinas de un rectángulo, y se
 * redibuja la imagen con ella.
 *
 * ── Por qué no alcanza `ctx.setTransform` ──────────────────────────────────
 *
 * El lienzo sólo sabe transformaciones AFINES: mueve, escala, rota y sesga,
 * pero mantiene el paralelismo. Una perspectiva justamente lo rompe — por eso
 * un trapecio no se puede enderezar con una sola llamada, por más que se busque
 * la matriz correcta. Hace falta una HOMOGRAFÍA, que el lienzo no tiene.
 *
 * La salida es dibujar por PEDAZOS: se parte el destino en una malla, y cada
 * celda es tan chica que dentro de ella la perspectiva se confunde con una
 * afín. Cada celda se dibuja con su propia matriz, recortada a su triángulo.
 * Con una malla suficientemente fina el resultado es indistinguible del
 * correcto, y corre en el lienzo que ya existe — sin WebGL y sin librerías.
 *
 * El error de esa aproximación baja con el cuadrado del tamaño de la celda, así
 * que 24 divisiones sobre 1600 px dejan cada celda en ~67 px: por debajo del
 * píxel, medido contra el mapeo exacto en `tests/unit/perspectiva.test.js`.
 */

/**
 * La homografía que lleva `origen` (4 puntos) a `destino` (4 puntos).
 *
 * Ocho incógnitas —la novena se fija en 1— y ocho ecuaciones, dos por punto.
 * Se resuelve por eliminación de Gauss con pivoteo parcial: sin pivoteo, un
 * cuadrilátero casi rectangular deja un pivote cerca de cero y la matriz sale
 * con ruido en vez de con la respuesta.
 *
 * @returns {number[]|null} los 9 coeficientes, o `null` si el sistema es
 *   degenerado — cuatro puntos alineados no definen ninguna transformación, y
 *   devolver una inventada deformaría la imagen sin avisar.
 */
export function homografia(origen, destino) {
    if (origen?.length !== 4 || destino?.length !== 4) return null;
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        const { x, y } = origen[i];
        const { x: u, y: v } = destino[i];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let col = 0; col < 8; col++) {
        let mejor = col;
        for (let f = col + 1; f < 8; f++) if (Math.abs(A[f][col]) > Math.abs(A[mejor][col])) mejor = f;
        if (Math.abs(A[mejor][col]) < 1e-10) return null;
        [A[col], A[mejor]] = [A[mejor], A[col]];
        [b[col], b[mejor]] = [b[mejor], b[col]];
        for (let f = 0; f < 8; f++) {
            if (f === col) continue;
            const k = A[f][col] / A[col][col];
            if (!k) continue;
            for (let c = col; c < 8; c++) A[f][c] -= k * A[col][c];
            b[f] -= k * b[col];
        }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [...h, 1];
}

/** Dónde cae un punto al aplicarle la homografía. */
export function aplicar(h, x, y) {
    const w = h[6] * x + h[7] * y + h[8];
    if (!w) return { x: 0, y: 0 };
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Las esquinas ordenadas arriba-izq, arriba-der, abajo-der, abajo-izq.
 *
 *  El modelo puede devolverlas en cualquier orden, y con el orden equivocado la
 *  imagen sale espejada o del revés. Se ordenan por su posición respecto del
 *  centro, que no depende de cómo vinieran. */
export function ordenarEsquinas(pts) {
    if (pts?.length !== 4) return null;
    // Sólo hace falta el centro en Y: separa arriba de abajo, y dentro de cada
    // mitad ordena la X. Con el centro en X también habría que decidir qué pasa
    // con un punto justo en la vertical del centro, y no aporta nada.
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const arriba = pts.filter(p => p.y < cy).sort((a, b) => a.x - b.x);
    const abajo  = pts.filter(p => p.y >= cy).sort((a, b) => a.x - b.x);
    if (arriba.length !== 2 || abajo.length !== 2) return null;
    return [arriba[0], arriba[1], abajo[1], abajo[0]];
}

/** Cuánto se aparta de un rectángulo, de 0 (ya lo es) a 1.
 *
 *  Sirve para no rectificar lo que no hace falta: redibujar una foto que ya está
 *  de frente sólo le agrega una interpolación y le quita nitidez. */
export function deformacion(esquinas) {
    const o = ordenarEsquinas(esquinas);
    if (!o) return 0;
    const largo = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const arriba = largo(o[0], o[1]), abajo = largo(o[3], o[2]);
    const izq = largo(o[0], o[3]), der = largo(o[1], o[2]);
    const dif = (a, b) => (Math.max(a, b) ? Math.abs(a - b) / Math.max(a, b) : 0);
    return Math.max(dif(arriba, abajo), dif(izq, der));
}

const DIVISIONES = 24;

/**
 * Redibuja el documento como si se hubiera fotografiado de frente.
 *
 * @param {CanvasImageSource} imagen
 * @param {{x,y}[]} esquinas   en PÍXELES de la imagen, en cualquier orden
 * @param {number} ancho       de la salida
 * @param {number} alto        de la salida
 * @returns {HTMLCanvasElement|null}
 */
export function rectificar(imagen, esquinas, ancho, alto, { yaOrdenadas = false } = {}) {
    /* `yaOrdenadas` existe desde que la persona puede GIRAR el resultado: el
     * cuarto de vuelta se aplica rotando el orden de las esquinas —cuál es la
     * de arriba a la izquierda— y volver a ordenarlas acá lo desharía en
     * silencio, dejando el botón de girar sin efecto. */
    const o = yaOrdenadas ? esquinas : ordenarEsquinas(esquinas);
    if (!o || !(ancho > 0) || !(alto > 0)) return null;
    // Del DESTINO al ORIGEN: para pintar cada pedazo del resultado hay que saber
    // de dónde sacarlo, no al revés.
    const h = homografia(
        [{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: alto }, { x: 0, y: alto }],
        o);
    if (!h) return null;

    const salida = document.createElement('canvas');
    salida.width = ancho; salida.height = alto;
    const ctx = salida.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    const paso = { x: ancho / DIVISIONES, y: alto / DIVISIONES };
    for (let fila = 0; fila < DIVISIONES; fila++) {
        for (let col = 0; col < DIVISIONES; col++) {
            const x0 = col * paso.x, y0 = fila * paso.y;
            const x1 = x0 + paso.x, y1 = y0 + paso.y;
            const p = [
                aplicar(h, x0, y0), aplicar(h, x1, y0),
                aplicar(h, x1, y1), aplicar(h, x0, y1),
            ];
            // Dos triángulos por celda: un cuadrilátero no tiene una afín que lo
            // mande a otro cuadrilátero, un triángulo sí — siempre.
            dibujarTriangulo(ctx, imagen, [p[0], p[1], p[2]], [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }]);
            dibujarTriangulo(ctx, imagen, [p[0], p[2], p[3]], [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
        }
    }
    return salida;
}

/* Un triángulo del origen dibujado sobre su triángulo del destino.
 *
 * El `+0.5` de expansión no es cosmético: sin él, entre celda y celda queda una
 * costura de un píxel donde se ve el fondo — el antialias de cada recorte no
 * llega a cubrir el borde del vecino, y el resultado es una rejilla visible
 * sobre todo el documento. */
/* ── La afín va del ORIGEN al DESTINO, no al revés ──────────────────────────
 *
 * `drawImage(imagen, 0, 0)` dibuja en el espacio de usuario ACTUAL: el píxel
 * (0,0) de la foto cae en el (0,0) de ese espacio. Entonces la matriz que hay
 * que instalar es la que lleva **coordenadas de la foto → coordenadas del
 * resultado**.
 *
 * Estaba escrita al revés —la que lleva destino → origen, que es la que sirve
 * para SABER de dónde sacar cada píxel, no para dibujarlo— así que cada triángulo
 * se pintaba con una porción equivocada de la foto. El recorte salía con el
 * documento corrido y agrandado, y con blanco donde el mapeo caía fuera.
 *
 * Sobrevivió porque las primeras pruebas usaban documentos de un color plano:
 * con un rectángulo uniforme, dibujar la porción equivocada se ve igual. Lo
 * destapó el usuario recortando la foto de una factura —«al dar en continuar
 * sale así»— y se confirmó midiendo: se pintan cuatro marcas de color en las
 * esquinas del documento y NINGUNA aparecía en el resultado.
 *
 * El clip sigue en coordenadas del destino: se aplica ANTES de instalar la
 * matriz, que es donde el recorte tiene que estar.
 */
/**
 * La afín que lleva el triángulo `orig` sobre el triángulo `dest`.
 *
 * Se exporta para poder PROBARLA sin un navegador. El comentario de la prueba de
 * la homografía decía «el dibujo por malla se mide aparte, en el navegador», y
 * esa medición nunca se hizo: la matemática de la homografía estaba bien y la
 * matriz del dibujo estaba invertida, así que las pruebas pasaban y el recorte
 * salía mal. Con la matriz como función pura, la dirección se comprueba en una
 * línea: aplicarla a cada vértice de `orig` tiene que dar el de `dest`.
 *
 * @returns {{a,b,c,e,tx,ty}|null} — (x,y) → (a·x + b·y + tx, c·x + e·y + ty)
 */
export function afinDeTriangulos(orig, dest) {
    const [o0, o1, o2] = orig, [d0, d1, d2] = dest;
    const den = (o1.x - o0.x) * (o2.y - o0.y) - (o2.x - o0.x) * (o1.y - o0.y);
    if (!den) return null;
    const a = ((d1.x - d0.x) * (o2.y - o0.y) - (d2.x - d0.x) * (o1.y - o0.y)) / den;
    const b = ((d2.x - d0.x) * (o1.x - o0.x) - (d1.x - d0.x) * (o2.x - o0.x)) / den;
    const c = ((d1.y - d0.y) * (o2.y - o0.y) - (d2.y - d0.y) * (o1.y - o0.y)) / den;
    const e = ((d2.y - d0.y) * (o1.x - o0.x) - (d1.y - d0.y) * (o2.x - o0.x)) / den;
    return { a, b, c, e,
        tx: d0.x - (a * o0.x + b * o0.y),
        ty: d0.y - (c * o0.x + e * o0.y) };
}

function dibujarTriangulo(ctx, imagen, orig, dest) {
    const [d0, d1, d2] = dest;
    const m = afinDeTriangulos(orig, dest);
    if (!m) return;
    const { a, b, c, e, tx, ty } = m;

    ctx.save();
    ctx.beginPath();
    const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
    const crecer = (p) => {
        const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / l) * 0.5, y: p.y + (dy / l) * 0.5 };
    };
    const [g0, g1, g2] = [crecer(d0), crecer(d1), crecer(d2)];
    ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y);
    ctx.closePath();
    ctx.clip();
    /* `ctx.transform(a,b,c,d,e,f)` mapea (x,y) → (a·x + c·y + e, b·x + d·y + f),
     * así que los coeficientes van cruzados respecto de cómo se nombran acá. */
    ctx.transform(a, c, b, e, tx, ty);
    ctx.drawImage(imagen, 0, 0);
    ctx.restore();
}

/**
 * Las cuatro esquinas de la imagen ENTERA, en fracciones y en orden ↖ ↗ ↘ ↙.
 *
 * Vive acá y no en el componente que las dibuja porque es un dato del dominio
 * —el punto de partida cuando no hay lectura automática— y porque un archivo de
 * componentes que además exporta constantes rompe el recargado en caliente.
 */
export const ESQUINAS_ENTERAS = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

/**
 * Cuánto mide el papel, en píxeles de la foto original.
 *
 * Los cuatro lados de un papel en perspectiva miden distinto —el que está más
 * lejos sale más corto—, así que se toma el MAYOR de cada par: recortar contra
 * el lado corto perdería parte del documento del lado largo, y agrandar después
 * no devuelve lo que se cortó.
 *
 * De acá sale la proporción del resultado, y por eso ya no hace falta elegir la
 * forma del papel de una lista: la forma se mide sobre el papel de esta foto.
 */
export function medidaDelPapel(esquinas) {
    if (!Array.isArray(esquinas) || esquinas.length !== 4) return null;
    const [tl, tr, br, bl] = esquinas;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const ancho = Math.max(d(tl, tr), d(bl, br));
    const alto  = Math.max(d(tl, bl), d(tr, br));
    if (!(ancho > 0) || !(alto > 0)) return null;
    return { ancho: Math.round(ancho), alto: Math.round(alto) };
}

/**
 * Un cuarto de vuelta, aplicado al ORDEN de las esquinas.
 *
 * Girar el resultado no es girar la foto: es decir cuál de las cuatro esquinas
 * del papel es la de arriba a la izquierda. Así el giro no cuesta una
 * interpolación —la foto no se vuelve a dibujar— y el resultado sale igual de
 * nítido en cualquier orientación.
 */
export function girarEsquinas(esquinas) {
    if (!Array.isArray(esquinas) || esquinas.length !== 4) return esquinas;
    const [tl, tr, br, bl] = esquinas;
    return [bl, tl, tr, br];
}
