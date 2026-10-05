import { describe, expect, it } from 'vitest';
import { distribucionDePregunta, indicesInvertidos, nivelDePuntaje, puntajeDeBloque, puntajeGlobal, valorDeRespuesta } from '@nucleo/utils/climaLaboral';

const rows = [{ r: ['A', 'D', 'B'] }, { r: ['B', 'C', 'A'] }, { r: ['C', 'B', 'C'] }];

describe('climaLaboral', () => {
    it('A–D y del 1 al 10 en la misma escala', () => {
        expect(valorDeRespuesta('a')).toBe(4);
        expect(valorDeRespuesta('9')).toBe(4);
        expect(valorDeRespuesta('6')).toBe(2);
        expect(valorDeRespuesta('-')).toBeNull();
    });
    it('una pregunta invertida se puntúa al revés', () => {
        const inv = indicesInvertidos([{ idx: 1, invertida: true }, { idx: 0 }]);
        expect(puntajeDeBloque(rows, [0, 1], inv)).toBe(75);
        expect(puntajeDeBloque(rows, [0, 1])).toBe(62.5);
        expect(puntajeGlobal(rows, [{ indices: [0, 1] }, { indices: [2] }], inv)).toBe(75);
        expect(puntajeDeBloque([], [0])).toBeNull();
    });
    it('la distribución y el nivel', () => {
        expect(distribucionDePregunta(rows, 2)).toEqual({ A: 1, B: 1, C: 1, D: 0, total: 3 });
        expect(nivelDePuntaje(75)).toEqual({ label: 'Bueno', severidad: 'info' });
        expect(nivelDePuntaje(40).label).toBe('Crítico');
    });
});
