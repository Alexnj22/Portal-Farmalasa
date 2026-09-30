import { describe, expect, it } from 'vitest';
import { anotarUso, ordenarPorUso, puntosAl, VIDA_MEDIA_DIAS } from '@nucleo/utils/ordenPorUso';

const DIA = 86400000;

describe('ordenPorUso', () => {
    it('sin uso respeta el orden por defecto', () => {
        expect(ordenarPorUso(['a', 'b', 'c'], {})).toEqual(['a', 'b', 'c']);
    });

    it('lo más tocado sube', () => {
        let r = {};
        const t = Date.now();
        r = anotarUso(r, 'c', t); r = anotarUso(r, 'c', t); r = anotarUso(r, 'b', t);
        expect(ordenarPorUso(['a', 'b', 'c'], r, t)).toEqual(['c', 'b', 'a']);
    });

    it('lo de esta semana manda sobre lo de hace meses', () => {
        const t = Date.now();
        const r = { viejo: { puntos: 10, en: t - 90 * DIA }, nuevo: { puntos: 2, en: t - 1 * DIA } };
        expect(ordenarPorUso(['viejo', 'nuevo'], r, t)).toEqual(['nuevo', 'viejo']);
    });

    it('el puntaje se reduce a la mitad en la vida media', () => {
        const t = Date.now();
        expect(puntosAl({ puntos: 8, en: t - VIDA_MEDIA_DIAS * DIA }, t)).toBeCloseTo(4, 5);
    });
});
