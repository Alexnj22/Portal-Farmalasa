import { describe, it, expect } from 'vitest';
import { lotesQueSalen, mesDeVencimiento, vencePronto } from '@nucleo/utils/preventaDirecta';

describe('lotesQueSalen', () => {
    const lotes = [{ lote: 'GENERICO', unidades: 5 }, { lote: 'A1', unidades: 10 }, { lote: 'B2', unidades: 3 }];
    it('toma del primero y sigue con el siguiente', () => {
        expect(lotesQueSalen(lotes, 8).map((l) => l.toma)).toEqual([5, 3, 0]);
    });
    it('sin pedir nada, no toma', () => {
        expect(lotesQueSalen(lotes, 0).map((l) => l.toma)).toEqual([0, 0, 0]);
    });
    it('si no alcanza, toma todo', () => {
        expect(lotesQueSalen(lotes, 99).map((l) => l.toma)).toEqual([5, 10, 3]);
    });
});

describe('vencimiento', () => {
    it('mes y año', () => { expect(mesDeVencimiento('2026-08-01')).toBe('08/2026'); expect(mesDeVencimiento(null)).toBe('—'); });
    it('pronto = menos de 90 días', () => {
        expect(vencePronto('2026-12-01', '2026-11-16')).toBe(true);
        expect(vencePronto('2027-06-01', '2026-11-16')).toBe(false);
    });
});

import { planDeLotes, queCompletar } from '@nucleo/utils/preventaDirecta';

describe('planDeLotes', () => {
    const lotes = [{ lote: 'GENERICO', vence: null, unidades: 6 }, { lote: 'A1', vence: '2028-03-01', unidades: 14 }];
    it('cajas enteras de cada lote, en orden', () => {
        const p = planDeLotes(lotes, 1, 10);
        expect(p.lotes.map((l) => [l.enteras, l.sueltas])).toEqual([[0, 0], [1, 0]]);
        expect(p.armada).toBe(false);
    });
    it('la caja que ningún lote completa se arma con dos', () => {
        const p = planDeLotes(lotes, 2, 10);
        expect(p.lotes.map((l) => [l.enteras, l.sueltas])).toEqual([[0, 6], [1, 4]]);
        expect(p.armada).toBe(true);
        expect(p.faltan).toBe(0);
    });
    it('el lote elegido va primero', () => {
        const p = planDeLotes(lotes, 3, 1, { lote: 'A1', vence: '2028-03-01' });
        expect(p.lotes[0].lote).toBe('A1');
        expect(p.lotes[0].enteras).toBe(3);
    });
    it('si no alcanza, dice cuánto falta', () => {
        expect(planDeLotes(lotes, 3, 10).faltan).toBe(2);  // como caja: no arma a medias
    });
});

describe('queCompletar', () => {
    it('crédito fiscal pide la categoría si no es contribuyente', () => {
        expect(queCompletar('credito_fiscal', { categoria: 'Consumidor' }).categoria).toBe('Contribuyente');
    });
    it('factura pide DUI sólo si no tiene ni DUI ni NIT', () => {
        expect(queCompletar('consumidor_final', { nit: '0614' }).campos).not.toContain('dui');
    });
});
