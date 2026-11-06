import { describe, it, expect } from 'vitest';
import { lotesDelDescargo } from '../../supabase/functions/_shared/erp-descarte.ts';

// De qué lotes sale un descargo (descarte, premio, salida de compras, y la
// asignación del lote de la caja).
const L = (id, numero, vence, stock) => ({ id, numero, vence, stock });

describe('lotesDelDescargo', () => {
    it('un lote que alcanza solo: el que vence primero, un renglón', () => {
        const r = lotesDelDescargo([L('1', 'B', '2029-01-01', 10), L('2', 'A', '2028-01-01', 10)], 2, 4);
        expect(r).toEqual({ renglones: [{ idLote: '2', numero: 'A', vence: '2028-01-01', cantidad: 2 }], faltan: 0 });
    });
    it('lo sin lote asignado partido cuenta junto (FOLIMEN: 2 + 2 blísteres, 1 caja ×4 no; 4 blísteres sí)', () => {
        const lotes = [L('7', 'GENERICO', '2028-10-01', 2), L('8', 'GENERICO', '2028-12-01', 2)];
        expect(lotesDelDescargo(lotes, 1, 4).faltan).toBe(1);
        const r = lotesDelDescargo(lotes, 4, 1);
        expect(r.faltan).toBe(0);
        expect(r.renglones.map(x => [x.idLote, x.cantidad])).toEqual([['7', 2], ['8', 2]]);
    });
    it('sin uno que alcance, completa por vencimiento con paquetes enteros', () => {
        const r = lotesDelDescargo([L('1', 'A', '2028-01-01', 8), L('2', 'B', '2029-01-01', 9)], 4, 4);
        expect(r.renglones.map(x => [x.numero, x.cantidad])).toEqual([['A', 2], ['B', 2]]);
        expect(r.faltan).toBe(0);
    });
    it('3 blísteres de un lote y 1 de otro: la caja ×4 no se arma, en unidades sí', () => {
        const lotes = [L('1', 'A', '2028-10-01', 3), L('2', 'B', '2028-12-01', 1)];
        expect(lotesDelDescargo(lotes, 1, 4).faltan).toBe(1);
        expect(lotesDelDescargo(lotes, 4, 1).renglones.map(x => [x.numero, x.cantidad])).toEqual([['A', 3], ['B', 1]]);
    });
    it('con lote nombrado, sólo ese lote', () => {
        const lotes = [L('1', 'A', '2028-01-01', 1), L('2', 'B', '2029-01-01', 9)];
        expect(lotesDelDescargo(lotes, 2, 1, 'A').faltan).toBe(1);
        expect(lotesDelDescargo(lotes, 2, 1, 'B').renglones).toEqual([{ idLote: '2', numero: 'B', vence: '2029-01-01', cantidad: 2 }]);
    });
});
