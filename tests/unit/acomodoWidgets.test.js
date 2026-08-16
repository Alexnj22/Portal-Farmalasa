import { describe, it, expect } from 'vitest';
import { reacomodar } from '../../src/utils/acomodoWidgets';

// La regla que decide dónde queda cada widget al soltar uno encima de otro.
//
// Se prueba acá y no en el navegador porque el defecto que la motivó era de
// aritmética, no de pintura: el acomodo viejo mandaba a los desplazados «a la
// primera celda libre barriendo desde la fila 1», así que un widget de la fila
// 8 aparecía arriba de todo. Eso se ve en un `expect`, no en una captura.

const medidas = (m) => (id) => m[id] ?? { cols: 1, rows: 1 };

describe('reacomodar', () => {
    it('mueve a un hueco libre sin tocar a nadie', () => {
        const acomodo = { a: { col: 1, row: 1 }, b: { col: 2, row: 1 } };
        const r = reacomodar('a', 4, 1, acomodo, medidas({}), 4);
        expect(r).toEqual({ a: { col: 4, row: 1 }, b: { col: 2, row: 1 } });
    });

    it('INTERCAMBIA cuando el destino lo ocupa uno solo del mismo tamaño', () => {
        const acomodo = { a: { col: 1, row: 1 }, b: { col: 3, row: 5 } };
        const r = reacomodar('a', 3, 5, acomodo, medidas({}), 4);
        expect(r.a).toEqual({ col: 3, row: 5 });
        // Lo que importa: `b` va al sitio de `a`, no a la primera celda libre
        // del tablero. Con el acomodo viejo terminaba en la fila 1.
        expect(r.b).toEqual({ col: 1, row: 1 });
    });

    it('intercambia también dos anchos iguales', () => {
        const m = { a: { cols: 2, rows: 2 }, b: { cols: 2, rows: 2 } };
        const acomodo = { a: { col: 1, row: 1 }, b: { col: 3, row: 4 } };
        const r = reacomodar('a', 3, 4, acomodo, medidas(m), 4);
        expect(r).toEqual({ a: { col: 3, row: 4 }, b: { col: 1, row: 1 } });
    });

    it('NO intercambia si el destino se solapa con el origen', () => {
        // Correr un 2×2 una celda a la derecha, sobre otro 2×2: intercambiarlos
        // los dejaría a los dos encima, porque el origen sigue debajo del
        // destino. Es la guarda que obliga el caso real de un ajuste chico.
        const m = { a: { cols: 2, rows: 2 }, b: { cols: 2, rows: 2 } };
        const acomodo = { a: { col: 1, row: 1 }, b: { col: 3, row: 1 } };
        const r = reacomodar('a', 2, 1, acomodo, medidas(m), 4);
        expect(r.a).toEqual({ col: 2, row: 1 });
        // Sin solaparse con `a`, que ahora ocupa las columnas 2-3 de la fila 1-2.
        const chocan = r.b.col < 4 && r.b.col + 2 > 2 && r.b.row < 3 && r.b.row + 2 > 1;
        expect(chocan).toBe(false);
    });

    it('NO intercambia al redimensionar (mismo sitio)', () => {
        // `updateWidgetSize` llama con la posición actual. Si eso intercambiara,
        // el otro widget iría justo encima del que no se movió.
        const m = { a: { cols: 2, rows: 1 }, b: { cols: 2, rows: 1 } };
        const acomodo = { a: { col: 1, row: 1 }, b: { col: 2, row: 1 } };
        const r = reacomodar('a', 1, 1, acomodo, medidas(m), 4);
        expect(r.a).toEqual({ col: 1, row: 1 });
        expect(r.b.col >= 3 || r.b.row > 1).toBe(true);
    });

    it('el desplazado NUNCA sube: se queda en su fila o baja', () => {
        // Éste es el defecto original. `c` vive en la fila 8; al soltar `a`
        // encima suyo, el acomodo viejo lo mandaba a la fila 1 —la primera
        // celda libre del tablero— y de paso empujaba a `b`. Hoy se corre al
        // hueco más cercano sin subir, y `b` ni se entera.
        const m = { a: { cols: 2, rows: 1 }, b: { cols: 1, rows: 1 }, c: { cols: 1, rows: 1 } };
        const acomodo = { a: { col: 1, row: 1 }, b: { col: 3, row: 1 }, c: { col: 3, row: 8 } };
        const r = reacomodar('a', 3, 8, acomodo, medidas(m), 4);
        expect(r.a).toEqual({ col: 3, row: 8 });
        expect(r.c.row).toBeGreaterThanOrEqual(8);
        expect(r.b).toEqual({ col: 3, row: 1 });
    });

    it('prefiere el hueco de la misma fila antes que bajar un renglón', () => {
        // `a` (2 anchos) cae sobre `c` en las columnas 3-4 de la fila 8. En esa
        // misma fila quedan libres las columnas 1-2, así que `c` se corre de
        // lado: conserva la banda horizontal, que es lo que uno ve.
        const m = { a: { cols: 2, rows: 1 }, c: { cols: 1, rows: 1 } };
        const acomodo = { a: { col: 1, row: 1 }, c: { col: 3, row: 8 } };
        const r = reacomodar('a', 3, 8, acomodo, medidas(m), 4);
        expect(r.c.row).toBe(8);
        expect(r.c.col).toBeLessThan(3);
    });

    it('baja cuando la fila está llena, en vez de irse arriba', () => {
        // Fila 5 completa con cuatro de 1×1. `a` mide 1×2 —así NO hay
        // intercambio, que necesita el mismo tamaño— y cae sobre `d`: no hay
        // hueco de lado, así que `d` baja. Lo que nunca puede pasar es que suba
        // a la fila 1, aunque el sitio que `a` dejó vacío esté justo ahí: es
        // exactamente lo que hacía el acomodo viejo.
        const m = { a: { cols: 1, rows: 2 }, b: { cols: 1, rows: 1 },
                    c: { cols: 1, rows: 1 }, d: { cols: 1, rows: 1 }, e: { cols: 1, rows: 1 } };
        const acomodo = { a: { col: 1, row: 1 },
                          b: { col: 1, row: 5 }, c: { col: 2, row: 5 },
                          d: { col: 3, row: 5 }, e: { col: 4, row: 5 } };
        const r = reacomodar('a', 3, 5, acomodo, medidas(m), 4);
        expect(r.a).toEqual({ col: 3, row: 5 });
        expect(r.d.row).toBeGreaterThan(5);
        // Los otros tres de la fila no se movieron.
        expect(r.b).toEqual({ col: 1, row: 5 });
        expect(r.c).toEqual({ col: 2, row: 5 });
        expect(r.e).toEqual({ col: 4, row: 5 });
    });

    it('no deja a nadie sin posición ni fuera de la retícula', () => {
        const m = {
            a: { cols: 2, rows: 2 }, b: { cols: 2, rows: 2 },
            c: { cols: 3, rows: 1 }, d: { cols: 1, rows: 3 }, e: { cols: 4, rows: 1 },
        };
        const acomodo = {
            a: { col: 1, row: 1 }, b: { col: 3, row: 1 },
            c: { col: 1, row: 3 }, d: { col: 4, row: 3 }, e: { col: 1, row: 6 },
        };
        const r = reacomodar('e', 1, 1, acomodo, medidas(m), 4);
        for (const id of Object.keys(acomodo)) {
            expect(r[id], id).toBeDefined();
            expect(r[id].col).toBeGreaterThanOrEqual(1);
            expect(r[id].row).toBeGreaterThanOrEqual(1);
            expect(r[id].col + m[id].cols - 1).toBeLessThanOrEqual(4);
        }
        // Y nadie se pisa con nadie.
        const ocupadas = new Set();
        for (const id of Object.keys(r)) {
            for (let c = r[id].col; c < r[id].col + m[id].cols; c++) {
                for (let f = r[id].row; f < r[id].row + m[id].rows; f++) {
                    expect(ocupadas.has(`${c},${f}`), `${id} pisa ${c},${f}`).toBe(false);
                    ocupadas.add(`${c},${f}`);
                }
            }
        }
    });

    it('mueve lo mínimo: sobre 200 tableros al azar, casi nadie se corre', () => {
        // La medida de «ya no desordena». Con el acomodo viejo un solo
        // movimiento reescribía el tablero entero; acá se cuenta cuántos
        // widgets cambian de lugar además del que se arrastró.
        let movidos = 0, casos = 0;
        // Determinista a propósito: un test que falla una vez cada diez
        // corridas no se arregla, se ignora.
        let semilla = 7;
        const azar = (n) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };

        for (let t = 0; t < 200; t++) {
            const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
            const m = Object.fromEntries(ids.map(id => [id, { cols: 1 + azar(2), rows: 1 + azar(2) }]));
            // Acomodo inicial: en columnas, uno debajo del otro, sin solapes.
            const acomodo = {}; let fila = 1;
            for (const id of ids) { acomodo[id] = { col: 1, row: fila }; fila += m[id].rows; }
            const arrastrado = ids[azar(ids.length)];
            const destino = { col: 1 + azar(4 - m[arrastrado].cols + 1), row: 1 + azar(fila) };
            const r = reacomodar(arrastrado, destino.col, destino.row, acomodo, medidas(m), 4);
            casos++;
            movidos += ids.filter(id => id !== arrastrado &&
                (r[id].col !== acomodo[id].col || r[id].row !== acomodo[id].row)).length;
        }
        // Menos de un widget desplazado por movimiento, en promedio.
        expect(movidos / casos).toBeLessThan(1);
    });
});
