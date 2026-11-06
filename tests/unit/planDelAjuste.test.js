import { describe, it, expect } from 'vitest';
import { planDelAjuste } from '../../supabase/functions/_shared/erp-ajuste-conteo.ts';

// Qué hace el conteo que corrige la caja con cada diferencia (por lote, en
// unidades base).
describe('planDelAjuste', () => {
    it('lo sin lote contado en su lote: descargo de GENERICO y carga del lote', () => {
        const p = planDelAjuste([
            { lote: 'L1', vence: '2028-10-01', unidades: 3 },
            { lote: 'GENERICO', vence: null, unidades: -3 },
        ], true);
        expect(p.cargas).toEqual([{ i: 0, lote: 'L1', vence: '2028-10-01', unidades: 3 }]);
        expect(p.descargos).toEqual([{ i: 1, lote: 'GENERICO', unidades: 3 }]);
        expect(p.rechazos).toEqual([]);
    });
    it('no carga unidades sin lote de más en un producto con lote', () => {
        const p = planDelAjuste([{ lote: 'GENERICO', vence: null, unidades: 2 }], true);
        expect(p.cargas).toEqual([]);
        expect(p.rechazos[0].error).toMatch(/sin lote de más/);
    });
    it('un lote nuevo sin vencimiento no se carga', () => {
        expect(planDelAjuste([{ lote: 'L9', vence: null, unidades: 1 }], true).rechazos).toHaveLength(1);
    });
    it('lo ya hecho no se repite y la presentación sin factor se rechaza', () => {
        const p = planDelAjuste([
            { lote: 'L1', vence: '2028-01-01', unidades: 4, hecho: true },
            { lote: 'L2', vence: '2028-01-01', unidades: -1, factor_desconocido: true },
        ], true);
        expect(p.cargas).toEqual([]);
        expect(p.descargos).toEqual([]);
        expect(p.rechazos).toHaveLength(1);
    });
    it('sin control de lote, todo va sin lote', () => {
        const p = planDelAjuste([{ lote: 'GENERICO', vence: null, unidades: 5 }], false);
        expect(p.cargas).toEqual([{ i: 0, lote: '', vence: '', unidades: 5 }]);
    });
    it('normaliza el número del lote', () => {
        expect(planDelAjuste([{ lote: ' l1  a ', vence: '2028-01-01', unidades: 1 }], true).cargas[0].lote).toBe('L1 A');
    });
});
