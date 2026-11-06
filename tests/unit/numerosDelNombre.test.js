import { describe, it, expect } from 'vitest';
import { diferenciasDeNumeros, medidas } from '../../supabase/functions/_shared/numerosDelNombre.ts';

// Casos reales del cruce de octubre (2026-11-05).
describe('diferenciasDeNumeros', () => {
    it('avisa concentración y peso distintos', () => {
        expect(diferenciasDeNumeros('Olexa 10 Mg X 28 Tabletas', 'OLEXA 5 MG X 28 TABLETAS')).toHaveLength(1);
        expect(diferenciasDeNumeros('ALGODON MIGASA 10Grs.', 'ALGODON MIGASA 100 GRS.')).toHaveLength(1);
        expect(diferenciasDeNumeros('Dexlanzopral DR 30mg x 30 cap', 'DEXLANZOPRAL 60MG X 30 CAPS')).toHaveLength(1);
    });
    it('no avisa lo que es igual escrito distinto', () => {
        expect(diferenciasDeNumeros('EUTIROX NF CAJA 75MCG X 50 TABLETAS', 'EUTIROX 75 MG CAJA X 50 TAB.')).toEqual([]);
        expect(diferenciasDeNumeros('AUGMENTIN TABS.625MG.X', 'AUGMENTIN 500/125MG X 10 TABLETAS')).toEqual([]);
        expect(diferenciasDeNumeros('ILTUX HCT COMPR. 40MG.+12.5 X', 'ILTUX HCT 40/12.5MG X 28 COMP')).toEqual([]);
        expect(diferenciasDeNumeros('JARDIANZ DUO 1000/12.5 MG CAJA X', 'JARDIANZ DUO 12.5/1000MG X 60 COMP')).toEqual([]);
        expect(diferenciasDeNumeros('FINE STRESS 25,000 X 1 AMP.', 'FINESTRES 25,000 AMPOLLA')).toEqual([]);
        expect(diferenciasDeNumeros('PRODUCTO 1 G', 'PRODUCTO 1000 MG')).toEqual([]);
    });
    it('no compara la cantidad por caja', () => {
        expect(diferenciasDeNumeros('PANADOL ULTRA x 104 Capletas', 'PANADOL ULTRA X 52 SOBRES')).toEqual([]);
        expect(diferenciasDeNumeros('DAFLON 500 MG X 60 COMP', 'DAFLON 500 CX30 COMP')).toEqual([]);
    });
    it('sólo compara lo que los dos nombran', () => {
        expect(diferenciasDeNumeros('Megex 40mg/mL Suspension', 'ZENTEL 4% SUSPENSION')).toEqual([]);
        expect(medidas('GASTROFLUX 10MG X 30 L163069').get('masa').crudo).toEqual(new Set([10]));
    });
});
