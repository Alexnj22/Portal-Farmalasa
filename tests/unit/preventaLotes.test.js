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
