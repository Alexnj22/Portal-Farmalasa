import { describe, it, expect } from 'vitest';
import { indexarLotes, repartir, repartirTodo, ocupadasPorLote } from '../../src/views/distribucion/lotes.js';

// El lote de cada renglón (pedido del usuario, 2026-09-29): primero vence,
// primero sale, y lo que no alcanza se reparte en el siguiente lote, abajo.

let n = 100;
const ctxDe = (filas, por = {}) => {
    const idx = indexarLotes(filas);
    return {
        lotesDe: (pid) => idx.get(String(pid)) ?? [],
        porDe: (pid, pres) => por[`${pid}|${pres}`] ?? 1,
        nuevo: (base, cambios) => ({ ...base, ...cambios, clave: n++ }),
    };
};
const r = (clave, cantidad, extra = {}) => ({ clave, product_id: '7', presentacion: 'UNIDAD', cantidad: String(cantidad), lote_id: null, ...extra });

const LOTES = [
    { id: 2, product_id: 7, lote: 'LARGO', vence: '2027-12-01', existencia: 100 },
    { id: 1, product_id: 7, lote: 'CORTO', vence: '2026-11-01', existencia: 1 },
    { id: 3, product_id: 7, lote: 'SIN-FECHA', vence: null, existencia: 50 },
];

describe('lotes de la venta', () => {
    it('ordena por vencimiento, sin fecha al final', () => {
        expect(indexarLotes(LOTES).get('7').map(l => l.lote)).toEqual(['CORTO', 'LARGO', 'SIN-FECHA']);
    });

    it('elige el que vence primero', () => {
        const res = repartir([r(1, 1)], 1, ctxDe(LOTES));
        expect(res).toHaveLength(1);
        expect(res[0].lote_id).toBe(1);
    });

    it('del lote 1 hay 1 y se venden 3: el resto va abajo con el siguiente lote', () => {
        const res = repartir([r(1, 3), r(9, 1, { product_id: '8' })], 1, ctxDe(LOTES));
        expect(res.map(c => [c.product_id, c.lote_id, c.cantidad])).toEqual([
            ['7', 1, '1'], ['7', 2, '2'], ['8', null, '1'],
        ]);
    });

    it('lo que ya ocupa otro renglón no se vuelve a ofrecer', () => {
        const carrito = [r(1, 1, { lote_id: 1 }), r(2, 5)];
        const res = repartir(carrito, 2, ctxDe(LOTES));
        expect(res.find(c => c.clave === 2).lote_id).toBe(2);
        expect(ocupadasPorLote(res, () => 1).get(1)).toBe(1);
    });

    it('si el tramo cae en un lote que ya tiene otro renglón, se suman (la base no admite dos iguales)', () => {
        const carrito = [r(1, 1, { lote_id: 1 }), r(2, 4, { lote_id: 2 })];
        // Subo el primero a 3: lo que no cabe en CORTO va a LARGO, que ya existe.
        const res = repartir(carrito.map(c => (c.clave === 1 ? { ...c, cantidad: '3' } : c)), 1, ctxDe(LOTES));
        expect(res.map(c => [c.clave, c.lote_id, c.cantidad])).toEqual([[1, 1, '1'], [2, 2, '6']]);
    });

    it('lo que no cabe en ningún lote se queda en el último tramo (la pantalla dice cuánto falta)', () => {
        const res = repartir([r(1, 200)], 1, ctxDe(LOTES));
        expect(res.map(c => [c.lote_id, c.cantidad])).toEqual([[1, '1'], [2, '100'], [3, '99']]);
    });

    it('una caja no se parte entre lotes', () => {
        const filas = [{ id: 1, product_id: 7, lote: 'A', vence: '2026-10-01', existencia: 15 }, { id: 2, product_id: 7, lote: 'B', vence: '2027-01-01', existencia: 40 }];
        const res = repartir([r(1, 3, { presentacion: 'CAJA' })], 1, ctxDe(filas, { '7|CAJA': 10 }));
        expect(res.map(c => [c.lote_id, c.cantidad])).toEqual([[1, '1'], [2, '2']]);
    });

    it('respeta el lote elegido a mano antes que el que vence primero', () => {
        const res = repartir([r(1, 2, { lote_id: 3 })], 1, ctxDe(LOTES));
        expect(res.map(c => [c.lote_id, c.cantidad])).toEqual([[3, '2']]);
    });

    it('sin lotes (sin existencia) el renglón va sin lote', () => {
        const res = repartir([r(1, 2, { product_id: '99', lote_id: 5 })], 1, ctxDe(LOTES));
        expect(res[0].lote_id).toBeNull();
    });

    it('repartirTodo arma una venta traída de otra («volver a vender»)', () => {
        const res = repartirTodo([r(1, 2), r(2, 1, { product_id: '8' })], ctxDe(LOTES));
        expect(res.map(c => [c.product_id, c.lote_id, c.cantidad])).toEqual([['7', 1, '1'], ['7', 2, '1'], ['8', null, '1']]);
    });
});
