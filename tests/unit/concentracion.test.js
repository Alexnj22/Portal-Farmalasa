import { describe, expect, it } from 'vitest';
import {
    claveDePrincipio, escribirConcentracion, leerConcentracion,
    normalizarConcentracion, normalizarPrincipio, normalizarUnidad,
} from '@nucleo/utils/concentracion';

// Las formas reales medidas en product_active_principles el 2026-10-30.
describe('normalizarConcentracion', () => {
    it.each([
        ['500 mg.', '500 mg'], ['500mg', '500 mg'], ['1 g.', '1 g'], ['5 gr', '5 g'],
        ['250 mcg.', '250 mcg'], ['400 ui', '400 UI'], ['250 mg/5 ml', '250 mg/5 mL'],
        ['40 mg/2ml', '40 mg/2 mL'], ['1 %', '1 %'], ['0,5 mg', '0.5 mg'], ['10 ml.', '10 mL'],
        ['5 mg/ml', '5 mg/mL'], ['2 g/100g', '2 g/100 g'], ['500', '500'],
    ])('%s → %s', (entrada, salida) => expect(normalizarConcentracion(entrada)).toBe(salida));

    it('lo que no entiende lo deja como vino', () => {
        expect(normalizarConcentracion('n/a')).toBe('n/a');
        expect(normalizarConcentracion('500 tabletas')).toBe('500 tabletas');
        expect(normalizarConcentracion('')).toBeNull();
    });
});

describe('leerConcentracion / escribirConcentracion', () => {
    it('separa cantidad y unidad', () => {
        expect(leerConcentracion('125 mg.')).toEqual({ cantidad: '125', unidad: 'mg', crudo: null });
        expect(leerConcentracion('n/a')).toEqual({ cantidad: '', unidad: '', crudo: 'n/a' });
    });
    it('sin cantidad no hay concentración', () => {
        expect(escribirConcentracion('', 'mg')).toBeNull();
        expect(escribirConcentracion('2,5', 'mg')).toBe('2.5 mg');
    });
    it('unidades desconocidas no se inventan', () => expect(normalizarUnidad('tabletas')).toBeNull());
});

describe('nombre del principio', () => {
    it('mayúsculas, tildes intactas, espacios limpios', () => {
        expect(normalizarPrincipio('  ácido   clavulánico ')).toBe('ÁCIDO CLAVULÁNICO');
    });
    it('la clave no distingue tildes', () => {
        expect(claveDePrincipio('Acetaminofén')).toBe(claveDePrincipio('ACETAMINOFEN'));
    });
});
