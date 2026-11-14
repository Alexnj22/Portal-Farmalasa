import { describe, it, expect } from 'vitest';
import { planDeLotesReales, rotuloDeAjuste } from '@nucleo/utils/conteoDeInventario';

const sinLote = { id: 's', lote: 'GENERICO', fecha_vencimiento: null, sistema_cantidad: 5 };
const conLote = { id: 'c', lote: '260330', fecha_vencimiento: '2028-03-01', sistema_cantidad: 5 };
const regulado = { pideLote: true, pideVence: true };

describe('planDeLotesReales', () => {
    it('sin lote: pide lote, vence y cantidad de cada uno', () => {
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: '', vence: '2028-01-01', cantidad: 5 }], regla: regulado }).error).toMatch(/lote/);
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: 'A1', vence: null, cantidad: 5 }], regla: regulado }).error).toMatch(/vencimiento/);
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: 'generico', vence: '2028-01-01', cantidad: 5 }], regla: regulado }).error).toMatch(/lote/);
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: '' }], regla: regulado }).error).toMatch(/cuántas/);
    });
    it('la prueba de Salud 4: una caja sin lote eran dos lotes (3 + 2), en una pasada', () => {
        const plan = planDeLotesReales({
            item: sinLote, sinLote: 0, regla: regulado,
            lotes: [{ lote: '260412', vence: '2028-04-01', cantidad: '3' }, { lote: ' 260533 ', vence: '2028-05-01', cantidad: 2 }],
        });
        expect(plan).toEqual({ original: 0, aHermanos: [], nuevos: [
            { lote: '260412', vence: '2028-04-01', cantidad: 3 },
            { lote: '260533', vence: '2028-05-01', cantidad: 2 },
        ] });
    });
    it('lo que de verdad no trae lote queda en el renglón original', () => {
        expect(planDeLotesReales({ item: sinLote, sinLote: '1', lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: 4 }], regla: regulado }).original).toBe(1);
        expect(planDeLotesReales({ item: sinLote, sinLote: '', lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: 4 }], regla: regulado }).error).toMatch(/no traen lote/);
    });
    it('un lote repetido es un error, no dos renglones', () => {
        expect(planDeLotesReales({ item: sinLote, regla: regulado,
            lotes: [{ lote: 'a1', vence: '2028-01-01', cantidad: 1 }, { lote: 'A1', vence: '2028-01-01', cantidad: 2 }] }).error).toMatch(/dos veces/);
    });
    it('un lote que ya es renglón del conteo va a ese renglón', () => {
        const hermanos = [sinLote, { id: 'h', lote: 'A1', fecha_vencimiento: '2028-01-01' }, { id: 'v', lote: 'B2', fecha_vencimiento: '2028-01-01', is_vencidos: true }];
        const plan = planDeLotesReales({ item: sinLote, hermanos, regla: regulado,
            lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: 4 }, { lote: 'B2', vence: '2028-01-01', cantidad: 1 }] });
        expect(plan.aHermanos).toEqual([{ id: 'h', cantidad: 4 }]);
        expect(plan.nuevos).toEqual([{ lote: 'B2', vence: '2028-01-01', cantidad: 1 }]);
    });
    it('con lote sin cambios: la cantidad queda en el mismo renglón', () => {
        expect(planDeLotesReales({ item: conLote, regla: regulado, lotes: [{ lote: '260330', vence: '2028-03-01', cantidad: 4 }] }))
            .toEqual({ original: 4, aHermanos: [], nuevos: [] });
    });
    it('con lote corregido: el original queda en 0 y entra el real', () => {
        expect(planDeLotesReales({ item: conLote, regla: regulado, lotes: [{ lote: '999', vence: '2028-03-01', cantidad: 5 }] }))
            .toEqual({ original: 0, aHermanos: [], nuevos: [{ lote: '999', vence: '2028-03-01', cantidad: 5 }] });
        expect(planDeLotesReales({ item: conLote, regla: regulado,
            lotes: [{ lote: '260330', vence: '2028-03-01', cantidad: 3 }, { lote: '777', vence: '2029-01-01', cantidad: 2 }] }).original).toBe(3);
    });
    it('producto sin lote: sólo el vencimiento decide', () => {
        const perecedero = { pideLote: false, pideVence: true };
        expect(planDeLotesReales({ item: sinLote, sinLote: 0, regla: perecedero, lotes: [{ lote: '', vence: '2027-05-01', cantidad: 3 }] }).nuevos)
            .toEqual([{ lote: null, vence: '2027-05-01', cantidad: 3 }]);
    });
});

describe('rotuloDeAjuste en lo contado', () => {
    it('3 cajas de 10 se leen como 3 cajas, con las unidades al final', () => {
        expect(rotuloDeAjuste({ lote: '260412', vence: '2028-04-01', unidades: 30, en_presentacion: [{ presentacion: 'CAJA', cantidad: 3 }] }))
            .toBe('+3 cajas · lote 260412 (vence 04/2028) · +30 unidades');
        expect(rotuloDeAjuste({ lote: 'GENERICO', vence: null, unidades: -50, en_presentacion: [{ presentacion: 'CAJA', cantidad: -5 }] }))
            .toBe('−5 cajas · sin lote asignado · −50 unidades');
        expect(rotuloDeAjuste({ lote: '251011', vence: '2027-10-01', unidades: 1, en_presentacion: [{ presentacion: 'FRASCO', cantidad: 1 }] }))
            .toBe('+1 frasco · lote 251011 (vence 10/2027)');
    });
});

describe('planDeLotesReales · el campo que falta (2026-11-14)', () => {
    it('cada error dice en qué campo se arregla', () => {
        expect(planDeLotesReales({ item: sinLote, sinLote: '', lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: 4 }], regla: regulado }).campo).toBe('sinLote');
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: 1 }, { lote: '', vence: '2028-01-01', cantidad: 1 }], regla: regulado }).campo).toBe('lote-1');
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: 'A1', vence: null, cantidad: 5 }], regla: regulado }).campo).toBe('vence-0');
        expect(planDeLotesReales({ item: sinLote, lotes: [{ lote: 'A1', vence: '2028-01-01', cantidad: '' }], regla: regulado }).campo).toBe('cantidad-0');
    });
});
