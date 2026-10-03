import { describe, it, expect } from 'vitest';
import { aplicacionesPorDosis, esPorMl, fmtMl, saldoDelRenglon } from '@nucleo/utils/inyeccionDosis';

// Los mismos números que se midieron contra la base en producción
// (transacción revertida, 2026-10-03): RUBRAVIDA 10 ml → 5 a 2 ml, 4 a 2.5 ml.
const rubravida = { total: 5, disponibles: 5, usadas: 0, unidades: '1.000', contenido_ml: '10.00', opciones_ml: [2, 2.5], dosis_ml: null };

describe('aplicacionesPorDosis', () => {
    it('vial de 10 ml', () => {
        expect(aplicacionesPorDosis(10, 2)).toBe(5);
        expect(aplicacionesPorDosis(10, 2.5)).toBe(4);
        expect(aplicacionesPorDosis(10, 3)).toBe(3);
    });
    it('no la tumba la coma flotante', () => {
        expect(aplicacionesPorDosis(7.5, 2.5)).toBe(3);
        expect(aplicacionesPorDosis(0.3, 0.1)).toBe(3);
    });
    it('sin datos, cero', () => {
        expect(aplicacionesPorDosis(10, 0)).toBe(0);
        expect(aplicacionesPorDosis(null, 2)).toBe(0);
    });
});

describe('saldoDelRenglon', () => {
    it('un renglón que no es por ml devuelve el suyo', () => {
        expect(saldoDelRenglon({ total: 3, disponibles: 2 }, 2)).toEqual({ total: 3, disponibles: 2, dosis: null });
        expect(esPorMl({ total: 3 })).toBe(false);
    });
    it('por ml sin dosis elegida todavía no se sabe', () => {
        expect(saldoDelRenglon(rubravida, null)).toBeNull();
    });
    it('por ml con la dosis elegida', () => {
        expect(saldoDelRenglon(rubravida, 2.5)).toEqual({ total: 4, disponibles: 4, dosis: 2.5 });
        expect(saldoDelRenglon({ ...rubravida, unidades: '2.000', usadas: 3 }, 2)).toEqual({ total: 10, disponibles: 7, dosis: 2 });
    });
    it('la dosis ya fijada por un cobro anterior manda sobre la elegida', () => {
        expect(saldoDelRenglon({ ...rubravida, dosis_ml: '2.50', usadas: 1 }, 2)).toEqual({ total: 4, disponibles: 3, dosis: 2.5 });
    });
});

describe('fmtMl', () => {
    it('sin ceros de más', () => {
        expect(fmtMl('2.50')).toBe('2.5');
        expect(fmtMl(2)).toBe('2');
        expect(fmtMl(null)).toBe('0');
        expect(fmtMl('x')).toBe('');
    });
});
