// Lo escrito sobre este módulo:
// `docs/TABLERO-DONDE-QUEDA-CADA-WIDGET-2026-08-24.md` — los tres reportes que
// llevaron a esta regla, la medición que la eligió (0.27 huecos contra 0.55 y
// 2.01), y por qué medir sobre tableros al azar invertía el resultado.
//
// Dónde queda cada widget después de soltar uno encima de otro.
//
// ── Cómo se llegó a esta regla (2026-08-16) ───────────────────────────────
// Tres reportes del usuario, cada uno destapando lo que el anterior no cubría:
//
//   1. «el movimiento se siente torpe, desordena todo lo que había ordenado».
//      La regla original mandaba a cada desplazado a la primera celda libre
//      barriendo desde la fila 1: uno de la fila 8 aparecía arriba de todo.
//   2. Se agregó un intercambio, pero sólo entre dos widgets del MISMO tamaño.
//   3. «si muevo un widget de 2×2 y hay 2 ahí de 1×1 intercambian puesto, y así
//      en otros casos. No deben haber espacios en blanco si alguno cabe».
//
// Hoy se calculan DOS acomodos y se elige el que deja menos huecos:
//
//   · **Intercambio y empuje** — los widgets bajo el destino se mudan al hueco
//     que deja el arrastrado si caben ahí adentro (un 2×2 sobre dos 1×1 los
//     manda a su hueco de 2×2); el resto se empuja hacia abajo, nunca hacia
//     arriba. Toca a poca gente.
//   · **Reempaque** — el arrastrado se clava donde se soltó y TODOS los demás
//     se recolocan en orden de lectura, cada uno al primer hueco libre. Mueve
//     mucho más, pero cierra huecos que el primero no puede.
//
// Los dos terminan con una **compactación**: cada widget flota hacia arriba en
// su columna mientras quepa.
//
// Elegir entre los dos no es una corazonada: está medido sobre 3,000
// movimientos al azar en tableros COMPACTOS —los que arma `empacarFilas`, que
// son los reales—, y la diferencia entre medir sobre tableros compactos y
// sobre tableros al azar invierte el resultado, así que la medición correcta
// era la primera:
//
//   huecos que deja       intercambio 0.55 · reempaque 2.01 · **elegir 0.27**
//   widgets desplazados   intercambio 0.41 · reempaque 2.95 · **elegir 0.55**
//
// O sea: la mitad de huecos por 0.14 widgets más de movimiento. El empate se
// resuelve a favor del intercambio, que es el que menos mueve.
//
// (La regla original, sobre esos mismos tableros: 4.71 huecos y 0.49
// desplazados — y sobre tableros irregulares producía además **37 acomodos
// inválidos de 3,000**, con widgets encimados.)

/** ¿Se pisan dos rectángulos de la retícula? */
const solapan = (aCol, aRow, aM, bCol, bRow, bM) =>
    aCol < bCol + bM.cols && aCol + aM.cols > bCol &&
    aRow < bRow + bM.rows && aRow + aM.rows > bRow;

/** Un tablero de celdas ocupadas, con las dos operaciones de siempre. */
function tablero(columnas) {
    const ocupadas = new Set();
    return {
        marcar(col, row, m) {
            for (let c = col; c < col + m.cols; c++)
                for (let r = row; r < row + m.rows; r++) ocupadas.add(`${c},${r}`);
        },
        entra(col, row, m, tope = Infinity) {
            if (col < 1 || row < 1 || col + m.cols - 1 > columnas) return false;
            if (row + m.rows - 1 > tope) return false;
            for (let c = col; c < col + m.cols; c++)
                for (let r = row; r < row + m.rows; r++) if (ocupadas.has(`${c},${r}`)) return false;
            return true;
        },
    };
}

/** De arriba a abajo y de izquierda a derecha: el orden en que se lee un tablero. */
const porLectura = (acomodo) => (a, b) => {
    const pa = acomodo[a], pb = acomodo[b];
    return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
};

/**
 * Mete `ids` DENTRO del rectángulo que dejó libre el arrastrado.
 * Devuelve `{ [id]: {col,row} }`, o `null` si no entran todos.
 *
 * Los grandes primero: colocar un 1×1 en medio de un hueco de 2×2 puede dejar
 * al 2×1 sin lugar aunque el área alcance. Ordenar por área descendente es la
 * heurística de siempre y acá alcanza — los huecos miden como mucho 4×4.
 */
function empacarEnElHueco(hueco, medidaHueco, ids, medidaDe, columnas) {
    const t = tablero(columnas);
    const salida = {};
    const filaTope = hueco.row + medidaHueco.rows - 1;
    const colTope  = hueco.col + medidaHueco.cols - 1;
    const grandes = [...ids].sort((a, b) => {
        const ma = medidaDe(a), mb = medidaDe(b);
        return (mb.cols * mb.rows) - (ma.cols * ma.rows);
    });
    for (const id of grandes) {
        const m = medidaDe(id);
        let puesto = false;
        for (let r = hueco.row; r <= filaTope - m.rows + 1 && !puesto; r++) {
            for (let c = hueco.col; c <= colTope - m.cols + 1 && !puesto; c++) {
                if (t.entra(c, r, m)) { t.marcar(c, r, m); salida[id] = { col: c, row: r }; puesto = true; }
            }
        }
        if (!puesto) return null;   // no entran todos: no hay intercambio
    }
    return salida;
}

/**
 * Cada widget flota hacia ARRIBA en su columna mientras quepa.
 *
 * Es lo que cumple «no deben haber espacios en blanco si alguno cabe»: un hueco
 * que quedó arriba se llena con lo que venía abajo, sin cambiar de columna y
 * sin cambiar el orden de lectura. Se procesa de arriba a abajo justamente para
 * eso — quien está más alto se asienta primero y le deja el sitio libre al de
 * abajo, no al revés.
 *
 * Sube sólo en vertical y no busca hueco a los costados: mover un widget de
 * columna sin que nadie se lo pida es exactamente lo que se reportó como
 * «desordena todo lo que había ordenado».
 */
function compactar(acomodo, medidaDe, columnas) {
    const t = tablero(columnas);
    const salida = {};
    for (const id of Object.keys(acomodo).sort(porLectura(acomodo))) {
        const m = medidaDe(id);
        const { col } = acomodo[id];
        let fila = acomodo[id].row;
        while (fila > 1 && t.entra(col, fila - 1, m)) fila--;
        t.marcar(col, fila, m);
        salida[id] = { col, row: fila };
    }
    return salida;
}

/**
 * @param {string}   idArrastrado
 * @param {number}   colDestino    1-indexada
 * @param {number}   filaDestino   1-indexada
 * @param {Object}   acomodo       { [id]: { col, row } }
 * @param {Function} medidaDe      (id) => { cols, rows }, ya recortada a `columnas`
 * @param {number}   columnas
 * @returns {Object} el acomodo nuevo, completo
 */
function porIntercambioYEmpuje(idArrastrado, colDestino, filaDestino, acomodo, medidaDe, columnas) {
    const medida = medidaDe(idArrastrado);
    const origen = acomodo[idArrastrado];
    // Redimensionar llama acá con el MISMO sitio: ahí no hay nada que
    // intercambiar, y hacerlo pondría al otro widget encima del que no se movió.
    const seMovio = !origen || origen.col !== colDestino || origen.row !== filaDestino;
    const otros = Object.keys(acomodo).filter(id => id !== idArrastrado);
    const encima = otros.filter(id =>
        solapan(colDestino, filaDestino, medida, acomodo[id].col, acomodo[id].row, medidaDe(id)));

    // ── 1. Intercambio por área ───────────────────────────────────────────
    // La guarda del solape origen↔destino es obligatoria: correr un 2×2 una
    // celda al costado deja el destino pisando el origen, y mudar al otro «al
    // hueco» lo pondría encima del que se acaba de mover.
    if (seMovio && origen && encima.length
        && !solapan(colDestino, filaDestino, medida, origen.col, origen.row, medida)) {
        const mudados = empacarEnElHueco(origen, medida, encima, medidaDe, columnas);
        if (mudados) {
            return compactar(
                { ...acomodo, ...mudados, [idArrastrado]: { col: colDestino, row: filaDestino } },
                medidaDe, columnas);
        }
    }

    // ── 2. Empuje local ───────────────────────────────────────────────────
    const t = tablero(columnas);
    t.marcar(colDestino, filaDestino, medida);
    const salida = { [idArrastrado]: { col: colDestino, row: filaDestino } };
    const enOrden = [...otros].sort(porLectura(acomodo));

    // Pasada 1: se quedan los que pueden quedarse. Va aparte de la búsqueda a
    // propósito — con una sola pasada, un desplazado podía llevarse el sitio de
    // alguien que todavía no se había procesado y que no se movía, y ése, ahora
    // sin casa, empujaba al siguiente. Dos widgets del acomodo original nunca se
    // pisan entre sí, así que acá lo único que puede bloquear a alguien es el
    // rectángulo del arrastrado y el orden deja de importar.
    const desplazados = [];
    for (const id of enOrden) {
        const m = medidaDe(id), p = acomodo[id];
        if (t.entra(p.col, p.row, m)) { t.marcar(p.col, p.row, m); salida[id] = { col: p.col, row: p.row }; }
        else desplazados.push(id);
    }

    // El techo del barrido sale del propio tablero —la fila más baja ocupada más
    // lo que mide el más alto—, no de un número fijo: un tope de 100 filas se
    // queda corto justo en el tablero largo, que es donde de verdad hay que
    // buscar. Con esto siempre queda una franja vacía debajo de todo.
    const fondo = enOrden.reduce(
        (max, id) => Math.max(max, acomodo[id].row + medidaDe(id).rows),
        filaDestino + medida.rows) + 1;

    // Pasada 2: sólo los que de verdad quedaron sin lugar. Desde SU fila hacia
    // abajo, y en cada fila SU columna primero.
    for (const id of desplazados) {
        const m = medidaDe(id), p = acomodo[id];
        let puesto = false;
        for (let r = p.row; r <= fondo + m.rows && !puesto; r++) {
            if (t.entra(p.col, r, m)) { t.marcar(p.col, r, m); salida[id] = { col: p.col, row: r }; puesto = true; break; }
            for (let c = 1; c <= columnas - m.cols + 1 && !puesto; c++) {
                if (t.entra(c, r, m)) { t.marcar(c, r, m); salida[id] = { col: c, row: r }; puesto = true; }
            }
        }
        if (!puesto) {
            // No debería alcanzarse —el techo garantiza franja vacía—, pero un
            // acomodo sin posición es un widget que desaparece de la pantalla:
            // vale más un lugar al fondo que un `undefined`.
            const col = Math.max(1, Math.min(p.col, columnas - m.cols + 1));
            t.marcar(col, fondo + m.rows + 1, m);
            salida[id] = { col, row: fondo + m.rows + 1 };
        }
    }

    // ── 3. Compactar ──────────────────────────────────────────────────────
    return compactar(salida, medidaDe, columnas);
}

/**
 * El arrastrado se CLAVA donde se soltó y todos los demás se recolocan en orden
 * de lectura, cada uno al primer hueco libre barriendo de arriba a abajo y de
 * izquierda a derecha.
 *
 * Mueve mucho más que el intercambio —casi el tablero entero—, y por eso no es
 * la regla por defecto sino la otra mitad de una elección. Lo que sí garantiza
 * es que ningún widget podría haberse colocado antes que donde quedó: los
 * huecos que sobrevivan son los que NADIE puede llenar. Es lo que cierra el
 * caso que el intercambio no cubre — soltar un 1×1 encima de un 2×2, donde el
 * grande no entra en el hueco del chico.
 */
function porReempaque(idArrastrado, colDestino, filaDestino, acomodo, medidaDe, columnas) {
    const t = tablero(columnas);
    t.marcar(colDestino, filaDestino, medidaDe(idArrastrado));
    const salida = { [idArrastrado]: { col: colDestino, row: filaDestino } };
    const otros = Object.keys(acomodo).filter(id => id !== idArrastrado).sort(porLectura(acomodo));
    // El techo sale del propio tablero: la suma de los altos es la peor fila
    // posible aunque nada quepa al lado de nada.
    const techo = otros.reduce((n, id) => n + medidaDe(id).rows, filaDestino + medidaDe(idArrastrado).rows) + 1;
    for (const id of otros) {
        const m = medidaDe(id);
        let puesto = false;
        for (let r = 1; r <= techo && !puesto; r++) {
            for (let c = 1; c <= columnas - m.cols + 1 && !puesto; c++) {
                if (t.entra(c, r, m)) { t.marcar(c, r, m); salida[id] = { col: c, row: r }; puesto = true; }
            }
        }
        if (!puesto) salida[id] = { ...acomodo[id] };
    }
    return compactar(salida, medidaDe, columnas);
}

/** Celdas vacías dentro del rectángulo que ocupa el tablero. */
function huecosDe(acomodo, medidaDe, columnas) {
    const ids = Object.keys(acomodo);
    if (!ids.length) return 0;
    const ocupadas = new Set();
    let ultima = 0;
    for (const id of ids) {
        const m = medidaDe(id), p = acomodo[id];
        ultima = Math.max(ultima, p.row + m.rows - 1);
        for (let c = p.col; c < p.col + m.cols; c++)
            for (let r = p.row; r < p.row + m.rows; r++) ocupadas.add(`${c},${r}`);
    }
    return ultima * columnas - ocupadas.size;
}

/**
 * @param {string}   idArrastrado
 * @param {number}   colDestino    1-indexada
 * @param {number}   filaDestino   1-indexada
 * @param {Object}   acomodo       { [id]: { col, row } }
 * @param {Function} medidaDe      (id) => { cols, rows }, ya recortada a `columnas`
 * @param {number}   columnas
 * @returns {Object} el acomodo nuevo, completo
 */
export function reacomodar(idArrastrado, colDestino, filaDestino, acomodo, medidaDe, columnas) {
    const conIntercambio = porIntercambioYEmpuje(idArrastrado, colDestino, filaDestino, acomodo, medidaDe, columnas);
    const conReempaque   = porReempaque(idArrastrado, colDestino, filaDestino, acomodo, medidaDe, columnas);
    // El empate va al intercambio: entre dos acomodos igual de densos, gana el
    // que deja más widgets donde estaban.
    return huecosDe(conReempaque, medidaDe, columnas) < huecosDe(conIntercambio, medidaDe, columnas)
        ? conReempaque
        : conIntercambio;
}
