import { describe, it, expect } from 'vitest';
import { reacomodar } from '../../src/utils/acomodoWidgets';

// La regla que decide dónde queda cada widget al soltar uno encima de otro.
//
// Se prueba acá y no en el navegador porque lo que se rompió tres veces era
// aritmética, no pintura: el acomodo original mandaba a los desplazados «a la
// primera celda libre barriendo desde la fila 1», el segundo sólo intercambiaba
// entre widgets del mismo tamaño exacto, y el tercero dejaba huecos que alguien
// podía llenar. Eso se ve en un `expect`, no en una captura.
//
// Los tableros de estas pruebas son COMPACTOS —bandas que suman las 4 columnas,
// sin una celda vacía— porque es la forma que tiene el tablero real: lo arma
// `empacarFilas`. Medir sobre tableros irregulares invierte el resultado, y ése
// fue el error de la primera medición.

const COLS = 4;
const medidas = (m) => (id) => m[id] ?? { cols: 1, rows: 1 };

/** Celdas vacías dentro del rectángulo que ocupa el tablero. */
function huecos(acomodo, m, cols = COLS) {
    const ocupadas = new Set();
    let ultima = 0;
    for (const id of Object.keys(acomodo)) {
        const p = acomodo[id], mm = m[id];
        ultima = Math.max(ultima, p.row + mm.rows - 1);
        for (let c = p.col; c < p.col + mm.cols; c++)
            for (let r = p.row; r < p.row + mm.rows; r++) ocupadas.add(`${c},${r}`);
    }
    return ultima * cols - ocupadas.size;
}

/** Nadie se pisa, nadie se sale y nadie se queda sin posición. */
function esValido(acomodo, m, cols = COLS) {
    const ocupadas = new Set();
    for (const id of Object.keys(m)) {
        const p = acomodo[id];
        if (!p) return `${id} quedó sin posición`;
        if (p.col < 1 || p.row < 1) return `${id} fuera de la retícula`;
        if (p.col + m[id].cols - 1 > cols) return `${id} se sale por la derecha`;
        for (let c = p.col; c < p.col + m[id].cols; c++)
            for (let r = p.row; r < p.row + m[id].rows; r++) {
                if (ocupadas.has(`${c},${r}`)) return `${id} pisa la celda ${c},${r}`;
                ocupadas.add(`${c},${r}`);
            }
    }
    return null;
}

/** ¿Está `id` completamente dentro del rectángulo que ocupaba `rect`? */
const dentroDe = (p, m, rect, mRect) =>
    p.col >= rect.col && p.col + m.cols <= rect.col + mRect.cols &&
    p.row >= rect.row && p.row + m.rows <= rect.row + mRect.rows;

describe('reacomodar', () => {
    it('EL CASO DEL USUARIO: un 2×2 sobre dos 1×1 los manda a su hueco', () => {
        // «si muevo un widget de 2x2 y hay 2 ahi de 1x1 intercambian puesto».
        const m = { A: { cols: 2, rows: 2 }, B: { cols: 1, rows: 1 },
                    C: { cols: 1, rows: 1 }, D: { cols: 2, rows: 1 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 3, row: 1 },
                        C: { col: 4, row: 1 }, D: { col: 3, row: 2 } };
        const r = reacomodar('A', 3, 1, antes, medidas(m), COLS);

        expect(esValido(r, m)).toBeNull();
        expect(r.A).toEqual({ col: 3, row: 1 });
        // B y C se mudaron al rectángulo que A dejó libre.
        expect(dentroDe(r.B, m.B, antes.A, m.A), 'B no fue al hueco de A').toBe(true);
        expect(dentroDe(r.C, m.C, antes.A, m.A), 'C no fue al hueco de A').toBe(true);
        expect(huecos(r, m), 'el tablero quedó con blancos').toBe(0);
    });

    it('un 2×2 sobre CUATRO 1×1: los cuatro caben en su hueco', () => {
        const m = { A: { cols: 2, rows: 2 }, B: { cols: 1, rows: 1 }, C: { cols: 1, rows: 1 },
                    D: { cols: 1, rows: 1 }, E: { cols: 1, rows: 1 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 3, row: 1 }, C: { col: 4, row: 1 },
                        D: { col: 3, row: 2 }, E: { col: 4, row: 2 } };
        const r = reacomodar('A', 3, 1, antes, medidas(m), COLS);

        expect(esValido(r, m)).toBeNull();
        expect(r.A).toEqual({ col: 3, row: 1 });
        for (const id of ['B', 'C', 'D', 'E']) {
            expect(dentroDe(r[id], m[id], antes.A, m.A), `${id} no fue al hueco de A`).toBe(true);
        }
        expect(huecos(r, m)).toBe(0);
    });

    it('dos del mismo tamaño se intercambian, y nadie más se mueve', () => {
        // El caso más simple del intercambio por área — no una regla aparte.
        const m = { A: { cols: 2, rows: 2 }, B: { cols: 2, rows: 2 },
                    C: { cols: 4, rows: 1 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 3, row: 1 }, C: { col: 1, row: 3 } };
        const r = reacomodar('A', 3, 1, antes, medidas(m), COLS);

        expect(esValido(r, m)).toBeNull();
        expect(r.A).toEqual({ col: 3, row: 1 });
        expect(r.B).toEqual({ col: 1, row: 1 });
        expect(r.C, 'C no tenía por qué moverse').toEqual({ col: 1, row: 3 });
        expect(huecos(r, m)).toBe(0);
    });

    it('un 1×1 sobre un 2×2 —donde el intercambio NO cabe— igual deja el mínimo de blancos', () => {
        // El grande no entra en el hueco del chico, así que gana el reempaque.
        // Con 6 celdas de contenido en 4 columnas, 2 blancos es el mínimo.
        const m = { A: { cols: 1, rows: 1 }, B: { cols: 2, rows: 2 }, C: { cols: 1, rows: 1 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 2, row: 1 }, C: { col: 4, row: 1 } };
        const r = reacomodar('A', 2, 1, antes, medidas(m), COLS);

        expect(esValido(r, m)).toBeNull();
        expect(r.A).toEqual({ col: 2, row: 1 });
        expect(huecos(r, m), 'quedaron más blancos de los inevitables').toBe(2);
    });

    it('NO intercambia si el destino se solapa con el origen', () => {
        // Correr un 2×2 una celda al costado: intercambiarlos los dejaría a los
        // dos encima, porque el origen sigue debajo del destino.
        const m = { A: { cols: 2, rows: 2 }, B: { cols: 2, rows: 2 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 3, row: 1 } };
        const r = reacomodar('A', 2, 1, antes, medidas(m), COLS);
        expect(esValido(r, m)).toBeNull();
        expect(r.A).toEqual({ col: 2, row: 1 });
    });

    it('NO intercambia al redimensionar, que llama con la MISMA posición', () => {
        // `updateWidgetSize` pasa el sitio actual. Si eso intercambiara, el otro
        // widget iría justo encima del que no se movió.
        const m = { A: { cols: 2, rows: 1 }, B: { cols: 2, rows: 1 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 3, row: 1 } };
        const r = reacomodar('A', 1, 1, antes, medidas(m), COLS);
        expect(esValido(r, m)).toBeNull();
        expect(r.A).toEqual({ col: 1, row: 1 });
    });

    it('compacta: nadie queda flotando con un blanco encima', () => {
        // «no deben haber espacios en blanco si alguno cabe». B está en la fila
        // 5 con su columna libre arriba: tiene que subir.
        const m = { A: { cols: 1, rows: 1 }, B: { cols: 1, rows: 1 } };
        const antes = { A: { col: 1, row: 1 }, B: { col: 2, row: 5 } };
        const r = reacomodar('A', 1, 1, antes, medidas(m), COLS);
        expect(r.B.row, 'B se quedó flotando').toBe(1);
        expect(huecos(r, m)).toBe(2);   // sólo las columnas 3 y 4, que nadie llena
    });

    it('sobre 400 tableros compactos: nunca inválido y casi sin blancos', () => {
        // Determinista a propósito: un test que falla una vez cada diez corridas
        // no se arregla, se ignora.
        let semilla = 7;
        const azar = (n) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
        // Bandas que suman exactamente 4 columnas — la forma que produce
        // `empacarFilas`, o sea la del tablero real.
        const REPARTOS = [[1, 1, 1, 1], [2, 1, 1], [1, 2, 1], [1, 1, 2], [2, 2], [3, 1], [1, 3], [4]];

        let blancos = 0, movidos = 0, casos = 0;
        for (let t = 0; t < 400; t++) {
            const m = {}, antes = {}, ids = [];
            let fila = 1, n = 0;
            while (n < 8) {
                const rep = REPARTOS[azar(REPARTOS.length)], alto = 1 + azar(3);
                let col = 1;
                for (const ancho of rep) {
                    const id = 'abcdefgh'[n++];
                    ids.push(id); m[id] = { cols: ancho, rows: alto }; antes[id] = { col, row: fila };
                    col += ancho;
                    if (n >= 8) break;
                }
                fila += alto;
            }
            const arrastrado = ids[azar(ids.length)];
            const alto = Math.max(...ids.map(i => antes[i].row + m[i].rows));
            const destino = { col: 1 + azar(COLS - m[arrastrado].cols + 1), row: 1 + azar(alto) };
            const r = reacomodar(arrastrado, destino.col, destino.row, antes, medidas(m), COLS);

            expect(esValido(r, m), `tablero ${t}`).toBeNull();
            casos++;
            blancos += huecos(r, m);
            movidos += ids.filter(id => id !== arrastrado &&
                (r[id].col !== antes[id].col || r[id].row !== antes[id].row)).length;
        }
        // Medido: 0.27 blancos y 0.55 desplazados por movimiento. Los topes van
        // holgados — es una red contra una regresión de fondo, no un ancla del
        // número exacto, que cambia con cualquier ajuste de la heurística.
        expect(blancos / casos, 'el acomodo dejó de ser compacto').toBeLessThan(1);
        expect(movidos / casos, 'volvió a desordenar el tablero').toBeLessThan(1.5);
    });
});
