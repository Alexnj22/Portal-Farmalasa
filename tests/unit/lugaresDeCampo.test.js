import { describe, it, expect } from 'vitest';
import { sugerenciasDeLugar, metrosEntre, distanciaDeLugar, RADIO_CERCA_M } from '@nucleo/utils/lugaresDeCampo';

const LUGARES = [
    { lugar: 'Mercado Central', respuestas: 12, lat: 14.0333, lng: -88.9389 },
    { lugar: 'Mercado de Tejutla', respuestas: 3, lat: 14.17, lng: -89.1 },
    { lugar: 'Parque de La Palma', respuestas: 5, lat: 14.3172, lng: -89.17 },
    { lugar: 'Mercadito', respuestas: 1, lat: null, lng: null },
];
const AQUI = { lat: 14.0340, lng: -88.9390 }; // ~80 m del Mercado Central

describe('lugares de campo', () => {
    it('mide en metros', () => {
        const m = metrosEntre(AQUI, LUGARES[0]);
        expect(m).toBeGreaterThan(60);
        expect(m).toBeLessThan(100);
        expect(metrosEntre(AQUI, { lat: null })).toBeNull();
    });

    it('sin escribir: sólo los cercanos', () => {
        const s = sugerenciasDeLugar(LUGARES, '', AQUI);
        expect(s.map((x) => x.lugar)).toEqual(['Mercado Central']);
        expect(s[0].cerca).toBe(true);
        expect(s[0].distancia).toBeLessThanOrEqual(RADIO_CERCA_M);
    });

    it('sin escribir y sin ubicación: nada', () => {
        expect(sugerenciasDeLugar(LUGARES, '', null)).toEqual([]);
    });

    it('escribiendo «merc»: los que coinciden, el cercano primero y después los más usados', () => {
        const s = sugerenciasDeLugar(LUGARES, 'merc', AQUI);
        expect(s.map((x) => x.lugar)).toEqual(['Mercado Central', 'Mercado de Tejutla', 'Mercadito']);
    });

    it('sin importar tildes ni mayúsculas', () => {
        expect(sugerenciasDeLugar(LUGARES, 'PARQUE DE LA PÁLMA', null).map((x) => x.lugar)).toEqual([]); // ya escrito igual
        expect(sugerenciasDeLugar(LUGARES, 'párque', null).map((x) => x.lugar)).toEqual(['Parque de La Palma']);
    });

    it('lo ya escrito igual no se sugiere', () => {
        expect(sugerenciasDeLugar(LUGARES, 'mercado central', AQUI).map((x) => x.lugar)).not.toContain('Mercado Central');
    });

    it('la distancia se lee', () => {
        expect(distanciaDeLugar(null)).toBeNull();
        expect(distanciaDeLugar(20)).toBe('aquí');
        expect(distanciaDeLugar(84)).toBe('a 80 m');
        expect(distanciaDeLugar(1430)).toBe('a 1.4 km');
    });
});
