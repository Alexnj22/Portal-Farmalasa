import { describe, expect, it } from 'vitest';
import { alcanceDeCorrida, estadoPorDominio } from '@nucleo/data/syncHealth';

describe('syncHealth', () => {
    it('el alcance: sucursal del origen, del portal, o global', () => {
        expect(alcanceDeCorrida({ erp_sucursal_id: 3 }, {}, { 3: 'Salud 1' })).toBe('Salud 1');
        expect(alcanceDeCorrida({ branch_id: 2 }, { 2: 'La Popular' })).toBe('La Popular');
        expect(alcanceDeCorrida({ branch_id: 9 })).toBe('Sucursal 9');
        expect(alcanceDeCorrida({})).toBe('Global');
    });
    it('cada dominio con su última corrida y la última buena', () => {
        const e = estadoPorDominio([
            { domain: 'products', success: false, checked_at: '3' },
            { domain: 'products', success: true, checked_at: '2' },
            { domain: 'minmax', success: true, checked_at: '1' },
            { domain: 'otro', success: false },
        ]);
        expect(e.map((x) => x.dominio)).toEqual(['products', 'minmax', 'purchases', 'backup']);
        expect(e[0]).toMatchObject({ fallas: 1, ultima: { checked_at: '3' }, ultimaBuena: { checked_at: '2' } });
        expect(e[2].ultima).toBeNull();
    });
});
