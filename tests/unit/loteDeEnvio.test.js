import { describe, it, expect } from 'vitest';
import { opcionesDeLote, pedidosQueNoEstan, eleccionEfectiva, venceMasCortoQueLoPedido, seisMesesDesde } from '@nucleo/utils/loteDeEnvio';

const SALA = [
    { lote: 'A', vence: '2027-01-01', unidades: 30 },
    { lote: 'B', vence: '2028-01-01', unidades: 8 },
    { lote: 'GENERICO', vence: null, unidades: 100 },
];

describe('qué se ofrece', () => {
    it('sólo lotes que cubren el renglón entero, y sin asignar al final', () => {
        const o = opcionesDeLote(SALA, 2, 10);
        expect(o.map(x => x.lote)).toEqual(['A', 'GENERICO']);
        expect(o[1].sinAsignar).toBe(true);
    });
});

describe('¿está lo pedido?', () => {
    it('falta el que no está o no alcanza', () => {
        expect(pedidosQueNoEstan({ lotes: [{ lote: 'B', vence: '2028-01-01', unidades: 20 }] }, SALA, 2, 10)).toEqual(['B']);
        expect(pedidosQueNoEstan({ lotes: [{ lote: 'Z', unidades: 10 }] }, SALA, 1, 10)).toEqual(['Z']);
        expect(pedidosQueNoEstan({ lotes: [{ lote: 'A', vence: '2027-01-01', unidades: 20 }] }, SALA, 2, 10)).toEqual([]);
    });
    it('con despacho parcial, el último reservado puede dar menos sin faltar', () => {
        const item = { lotes: [{ lote: 'A', unidades: 20 }, { lote: 'B', unidades: 20 }] };
        expect(pedidosQueNoEstan(item, SALA, 2, 10)).toEqual([]);   // 20 de A cubren lo que sale
        expect(pedidosQueNoEstan(item, SALA, 4, 10)).toEqual(['B']); // de B se esperan 20 y hay 8
    });
    it('GENERICO reservado no es un lote pedido', () => {
        expect(pedidosQueNoEstan({ lotes: [{ lote: 'GENERICO', unidades: 500 }] }, SALA, 1, 1)).toEqual([]);
    });
});

describe('qué vale como elegido', () => {
    it('una sola opción viene elegida; varias, ninguna', () => {
        expect(eleccionEfectiva(null, [{ lote: 'A' }])).toEqual({ lote: 'A' });
        expect(eleccionEfectiva(null, [{ lote: 'A' }, { lote: 'B' }])).toBeNull();
        expect(eleccionEfectiva({ lote: 'B' }, [{ lote: 'A' }, { lote: 'B' }])).toEqual({ lote: 'B' });
    });
});

describe('venceMasCortoQueLoPedido', () => {
    const item = { lotes: [{ lote: 'L1', vence: '2028-01-01', unidades: 10 }] };
    it('seis meses desde hoy', () => {
        expect(seisMesesDesde('2026-11-05')).toBe('2027-05-05');
    });
    it('cuenta sólo si vence antes que lo pedido Y dentro de 6 meses', () => {
        expect(venceMasCortoQueLoPedido('2027-02-01', item, '2026-11-05')).toBe(true);
        expect(venceMasCortoQueLoPedido('2027-05-05', item, '2026-11-05')).toBe(true);
        expect(venceMasCortoQueLoPedido('2027-06-01', item, '2026-11-05')).toBe(false);
        expect(venceMasCortoQueLoPedido('2028-02-01', item, '2026-11-05')).toBe(false);
    });
    it('sin lote real pedido, o sin fecha, no pregunta', () => {
        expect(venceMasCortoQueLoPedido('2027-01-01', { lotes: [] }, '2026-11-05')).toBe(false);
        expect(venceMasCortoQueLoPedido('', item, '2026-11-05')).toBe(false);
    });
});
