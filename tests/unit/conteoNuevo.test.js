import { describe, it, expect } from 'vitest';
import { pedidoDeConteo, ALCANCES_DE_CONTEO } from '@nucleo/utils/conteoDeInventario';

describe('pedidoDeConteo', () => {
    it('cíclico: manda el tamaño y exige un entero positivo', () => {
        expect(pedidoDeConteo({ scopeType: 'CICLICO', tamano: '200' })).toEqual({ falta: null, scopeFilter: { tamano: 200 }, erpProductIds: null });
        expect(pedidoDeConteo({ scopeType: 'CICLICO', tamano: '0' }).falta).toBeTruthy();
        expect(pedidoDeConteo({ scopeType: 'CICLICO', tamano: '' }).falta).toBeTruthy();
    });
    it('laboratorio: exige el laboratorio y lo manda como número', () => {
        expect(pedidoDeConteo({ scopeType: 'LABORATORIO' }).falta).toBeTruthy();
        expect(pedidoDeConteo({ scopeType: 'LABORATORIO', laboratorioId: '12' }).scopeFilter).toEqual({ laboratorio_id: 12 });
    });
    it('manual: exige productos y manda sus ids', () => {
        expect(pedidoDeConteo({ scopeType: 'MANUAL' }).falta).toBeTruthy();
        const r = pedidoDeConteo({ scopeType: 'MANUAL', productos: [{ id: 5 }, { id: 9 }] });
        expect(r).toEqual({ falta: null, scopeFilter: null, erpProductIds: [5, 9] });
    });
    it('total y bajo receta no llevan filtro', () => {
        for (const scopeType of ['TOTAL', 'BAJO_RECETA']) {
            expect(pedidoDeConteo({ scopeType })).toEqual({ falta: null, scopeFilter: null, erpProductIds: null });
        }
        expect(ALCANCES_DE_CONTEO.map((a) => a.value)).toEqual(['CICLICO', 'TOTAL', 'LABORATORIO', 'BAJO_RECETA', 'MANUAL']);
    });
});
