// Dónde queda cada widget después de soltar uno encima de otro.
//
// ── Por qué se reescribió (2026-08-16) ────────────────────────────────────
// Reportado por el usuario: «el movimiento de widget se siente torpe, al pasar
// de un lado a otro, desordena todo lo que había ordenado».
//
// Y era exacto, no una impresión. La versión anterior resolvía así: el widget
// arrastrado se queda con su destino, y **cada desplazado se recoloca en la
// primera celda libre barriendo desde la fila 1, columna 1**. O sea que un
// widget que vivía en la fila 8 aparecía arriba de todo, y cada recolocación
// liberaba un hueco que podía subir al siguiente. Un solo movimiento
// reescribía el tablero entero, que es justo lo que uno acomodó a mano.
//
// Acá hay dos reglas, en este orden:
//
//   1. **Intercambio.** Si el destino lo ocupa UN solo widget y mide lo mismo,
//      los dos se cambian de lugar. Es lo que espera cualquiera que arrastre
//      una cosa encima de otra, y no mueve a nadie más.
//
//   2. **Empuje local.** Si no se puede intercambiar, cada desplazado busca
//      lugar **desde su propia fila hacia abajo**, y en cada fila prueba
//      primero su propia columna. La garantía que importa es que **nunca
//      sube**: el tablero se abre hacia abajo en vez de barajarse.
//
//      Dentro de esa garantía, prefiere el hueco más cercano — si en su misma
//      fila queda sitio, se corre de lado antes que bajar un renglón, porque
//      eso conserva la banda horizontal que uno ve. La preferencia por la
//      propia columna es una desempate dentro de la fila, no por encima de
//      ella; está medido en `tests/unit/acomodoWidgets.test.js`.
//
// El caso que obliga a la guarda del intercambio: mover un widget de 2×2 una
// celda a la derecha, sobre otro de 2×2. El destino se solapa con el ORIGEN,
// así que intercambiarlos dejaría a los dos encima. Cuando los dos rectángulos
// se tocan, no hay intercambio posible y manda el empuje.

/** ¿Se pisan dos rectángulos de la retícula? */
const solapan = (aCol, aRow, aM, bCol, bRow, bM) =>
    aCol < bCol + bM.cols && aCol + aM.cols > bCol &&
    aRow < bRow + bM.rows && aRow + aM.rows > bRow;

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
    const medida = medidaDe(idArrastrado);
    const origen = acomodo[idArrastrado];
    // Redimensionar llama acá con el MISMO sitio: ahí no hay nada que
    // intercambiar, y hacerlo pondría al otro widget encima del que no se movió.
    const seMovio = !origen || origen.col !== colDestino || origen.row !== filaDestino;

    const otros = Object.keys(acomodo).filter(id => id !== idArrastrado);

    // ── 1. Intercambio ────────────────────────────────────────────────────
    const encima = otros.filter(id =>
        solapan(colDestino, filaDestino, medida, acomodo[id].col, acomodo[id].row, medidaDe(id)));

    if (seMovio && origen && encima.length === 1
        && !solapan(colDestino, filaDestino, medida, origen.col, origen.row, medida)) {
        const otro = encima[0];
        const suya = medidaDe(otro);
        if (suya.cols === medida.cols && suya.rows === medida.rows) {
            // El hueco que deja el arrastrado mide exactamente lo que el otro
            // necesita, y nadie más lo ocupaba: el intercambio siempre entra.
            return {
                ...acomodo,
                [idArrastrado]: { col: colDestino, row: filaDestino },
                [otro]:         { col: origen.col, row: origen.row },
            };
        }
    }

    // ── 2. Empuje local ───────────────────────────────────────────────────
    const ocupadas = new Set();
    const marcar = (col, row, m) => {
        for (let c = col; c < col + m.cols; c++)
            for (let r = row; r < row + m.rows; r++) ocupadas.add(`${c},${r}`);
    };
    const entra = (col, row, m) => {
        if (col < 1 || row < 1 || col + m.cols - 1 > columnas) return false;
        for (let c = col; c < col + m.cols; c++)
            for (let r = row; r < row + m.rows; r++) if (ocupadas.has(`${c},${r}`)) return false;
        return true;
    };

    marcar(colDestino, filaDestino, medida);
    const salida = { [idArrastrado]: { col: colDestino, row: filaDestino } };

    // De arriba a abajo y de izquierda a derecha: quien está más arriba elige
    // primero, así el orden de lectura se conserva.
    const enOrden = [...otros].sort((a, b) => {
        const pa = acomodo[a], pb = acomodo[b];
        return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    });

    // El techo del barrido sale del propio tablero —la fila más baja ocupada
    // más lo que mide el más alto—, no de un número fijo: un tope de 100 filas
    // se queda corto justo en el tablero largo, que es donde de verdad hay que
    // buscar. Con esto siempre queda una franja vacía debajo de todo.
    const fondo = enOrden.reduce(
        (max, id) => Math.max(max, acomodo[id].row + medidaDe(id).rows),
        filaDestino + medida.rows) + 1;

    // ── Pasada 1: se quedan los que pueden quedarse ───────────────────────
    // Va aparte de la búsqueda a propósito. Con una sola pasada, un desplazado
    // que buscaba lugar podía quedarse con el sitio de alguien que todavía no
    // se había procesado y que no se movía — y ése, ahora sin casa, empujaba al
    // siguiente. Medido: soltar un widget sobre una fila llena movía a DOS
    // vecinos en vez de a uno. Acá el orden ya no puede desalojar a nadie: dos
    // widgets del acomodo original nunca se pisan entre sí, así que lo único
    // que puede bloquear a alguien es el rectángulo del arrastrado.
    const desplazados = [];
    for (const id of enOrden) {
        const m = medidaDe(id);
        const p = acomodo[id];
        if (entra(p.col, p.row, m)) { marcar(p.col, p.row, m); salida[id] = { col: p.col, row: p.row }; }
        else desplazados.push(id);
    }

    // ── Pasada 2: sólo los que de verdad quedaron sin lugar ───────────────
    for (const id of desplazados) {
        const m = medidaDe(id);
        const p = acomodo[id];
        let puesto = false;
        // Desde SU fila hacia abajo, y en cada fila SU columna primero.
        for (let r = p.row; r <= fondo + m.rows && !puesto; r++) {
            if (entra(p.col, r, m)) {
                marcar(p.col, r, m); salida[id] = { col: p.col, row: r }; puesto = true; break;
            }
            for (let c = 1; c <= columnas - m.cols + 1 && !puesto; c++) {
                if (entra(c, r, m)) { marcar(c, r, m); salida[id] = { col: c, row: r }; puesto = true; }
            }
        }
        if (!puesto) {
            // No debería alcanzarse —el techo garantiza franja vacía—, pero un
            // acomodo sin posición es un widget que desaparece de la pantalla:
            // vale más un lugar al fondo que un `undefined`.
            const col = Math.max(1, Math.min(p.col, columnas - m.cols + 1));
            marcar(col, fondo + m.rows + 1, m);
            salida[id] = { col, row: fondo + m.rows + 1 };
        }
    }
    return salida;
}
