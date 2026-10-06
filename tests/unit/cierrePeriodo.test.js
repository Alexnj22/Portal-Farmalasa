import { describe, expect, it } from 'vitest';
import { cadenaDelRemanente, derivoDelCierre, saldoDelPeriodo, totalesDeLaCadena } from '@nucleo/utils/cierrePeriodo';

describe('cierrePeriodo', () => {
    it('el saldo: a pagar o remanente', () => {
        expect(saldoDelPeriodo({ debito_fiscal: 100, credito_fiscal: 30 }, false, 0)).toEqual({ credito: 30, aPagar: 70, remanente: 0 });
        expect(saldoDelPeriodo({ debito_fiscal: 100, credito_fiscal: 30, credito_declarable: 150 }, true, 0)).toEqual({ credito: 150, aPagar: 0, remanente: 50 });
    });
    it('el remanente pasa al mes siguiente; el cerrado conserva lo congelado', () => {
        const c = cadenaDelRemanente([
            { periodo: '2026-07', debito_fiscal: 10, credito_fiscal: 60 },
            { periodo: '2026-08', debito_fiscal: 100, credito_fiscal: 20 },
            { periodo: '2026-09', estado: 'cerrado', cong_credito: 5, cong_a_pagar: 0, cong_remanente_sale: 12, cong_entra: 3 },
            { periodo: '2026-10', en_curso: true, debito_fiscal: 1 },
        ], false);
        expect(c[0].remanente).toBe(50);
        expect(c[1]).toMatchObject({ entra: 50, aPagar: 30 });
        expect(c[2]).toMatchObject({ entra: 3, remanente: 12 });
        expect(c[3].entra).toBe(12);
        expect(totalesDeLaCadena(c)).toEqual({ cerrados: 1, abiertos: 2, perdido: 50 });
    });
    it('la deriva sólo cuenta en un cerrado', () => {
        expect(derivoDelCierre({ estado: 'cerrado', deriva_debito: 27.23 })).toBe(true);
        expect(derivoDelCierre({ estado: 'abierto', deriva_debito: 27.23 })).toBe(false);
        expect(derivoDelCierre({ estado: 'cerrado', deriva_debito: 0.001 })).toBe(false);
    });
});
