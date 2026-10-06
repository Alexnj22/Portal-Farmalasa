import { describe, expect, it } from 'vitest';
import { diasDesde, gruposDePendientes, idsElegidos, resumenDePendientes } from '@nucleo/utils/inyeccionesPendientes';

const filas = [
    { id: 1, cobro_id: 10, producto: 'B', dosis_ml: null, precio: 2, customer_id: 7, branch_id: 4, pagada_at: '2026-09-20T12:00:00Z' },
    { id: 2, cobro_id: 10, producto: 'B', dosis_ml: null, precio: 2, customer_id: 7, branch_id: 4, pagada_at: '2026-09-20T12:00:00Z' },
    { id: 3, cobro_id: 11, producto: 'E', dosis_ml: 1, precio: 1, cliente: 'X', branch_id: 2, pagada_at: '2026-10-04T12:00:00Z' },
];
const ahora = Date.parse('2026-10-05T12:00:00Z');

describe('inyeccionesPendientes', () => {
    it('agrupa por pago, producto y dosis', () => {
        const g = gruposDePendientes(filas);
        expect(g.map((x) => x.ids)).toEqual([[1, 2], [3]]);
        expect(idsElegidos(g, { [g[0].clave]: 1, [g[1].clave]: 1 })).toEqual([1, 3]);
    });
    it('resume: total, clientes, las de 7 días o más y las de otra sala', () => {
        expect(resumenDePendientes(filas, 4, ahora)).toEqual({ aplicaciones: 3, total: 5, clientes: 2, viejas: 2, deOtras: 1 });
        expect(resumenDePendientes(filas, null, ahora).deOtras).toBe(0);
    });
    it('los días nunca son negativos', () => {
        expect(diasDesde('2026-10-06T00:00:00Z', ahora)).toBe(0);
        expect(diasDesde(null, ahora)).toBe(0);
    });
});
