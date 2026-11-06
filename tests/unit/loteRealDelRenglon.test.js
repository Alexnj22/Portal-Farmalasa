import { describe, it, expect } from 'vitest';
import { planDeLoteReal } from '@nucleo/utils/conteoDeInventario';

const sinLote = { lote: 'GENERICO', fecha_vencimiento: null, sistema_cantidad: 5 };
const conLote = { lote: '260330', fecha_vencimiento: '2028-03-01', sistema_cantidad: 5 };
const regulado = { pideLote: true, pideVence: true };

describe('planDeLoteReal', () => {
    it('sin lote: pide lote y vence', () => {
        expect(planDeLoteReal({ item: sinLote, lote: '', vence: '2028-01-01', cantidad: 5, regla: regulado }).error).toMatch(/lote/);
        expect(planDeLoteReal({ item: sinLote, lote: 'A1', vence: '', cantidad: 5, regla: regulado }).error).toMatch(/vencimiento/);
        expect(planDeLoteReal({ item: sinLote, lote: 'generico', vence: '2028-01-01', cantidad: 5, regla: regulado }).error).toMatch(/lote/);
    });
    it('sin lote con lote anotado: mueve, y en el original queda 0', () => {
        expect(planDeLoteReal({ item: sinLote, lote: ' a1 ', vence: '2028-01-01', cantidad: '5', regla: regulado }))
            .toEqual({ tipo: 'MOVER', lote: 'A1', vence: '2028-01-01', cantidad: 5, quedan: 0 });
    });
    it('con lote sin cambios: confirma en el mismo renglón', () => {
        expect(planDeLoteReal({ item: conLote, lote: '260330', vence: '2028-03-01', cantidad: 4, regla: regulado }))
            .toEqual({ tipo: 'CONFIRMAR', cantidad: 4 });
    });
    it('con lote corregido: mueve', () => {
        expect(planDeLoteReal({ item: conLote, lote: '260330', vence: '2028-04-01', cantidad: 5, quedan: '1', regla: regulado }).tipo).toBe('MOVER');
        expect(planDeLoteReal({ item: conLote, lote: '999', vence: '2028-03-01', cantidad: 5, regla: regulado }).quedan).toBe(0);
    });
    it('cantidades: enteros de 0 o más', () => {
        expect(planDeLoteReal({ item: sinLote, lote: 'A1', vence: '2028-01-01', cantidad: '', regla: regulado }).error).toBeTruthy();
        expect(planDeLoteReal({ item: sinLote, lote: 'A1', vence: '2028-01-01', cantidad: -1, regla: regulado }).error).toBeTruthy();
        expect(planDeLoteReal({ item: sinLote, lote: 'A1', vence: '2028-01-01', cantidad: 2, quedan: 1.5, regla: regulado }).error).toBeTruthy();
    });
    it('producto sin lote: sólo el vencimiento decide', () => {
        const perecedero = { pideLote: false, pideVence: true };
        expect(planDeLoteReal({ item: sinLote, lote: '', vence: '2027-05-01', cantidad: 3, regla: perecedero }))
            .toMatchObject({ tipo: 'MOVER', lote: null });
        expect(planDeLoteReal({ item: sinLote, lote: '', vence: '', cantidad: 3, regla: { pideLote: false, pideVence: false } }).tipo).toBe('CONFIRMAR');
    });
});
