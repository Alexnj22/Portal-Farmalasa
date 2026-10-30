import { describe, expect, it } from 'vitest';
import { revisarCalidad } from '@nucleo/utils/calidadDeFoto';

const claves = (m) => revisarCalidad(m).map((p) => p.clave);

describe('revisarCalidad', () => {
    it('una foto buena no tiene problemas', () => expect(claves({ ancho: 1200, alto: 900, nitidez: 300, contraste: 50 })).toEqual([]));
    it('una miniatura de Google bloquea', () => {
        const [p] = revisarCalidad({ ancho: 225, alto: 225, nitidez: 300, contraste: 50 });
        expect(p).toMatchObject({ clave: 'pequena', bloquea: true });
    });
    it('el lado MENOR es el que cuenta', () => expect(claves({ ancho: 2000, alto: 200 })).toEqual(['pequena']));
    it('entre 250 y 500 avisa sin bloquear', () => {
        expect(revisarCalidad({ ancho: 400, alto: 400 })).toEqual([expect.objectContaining({ clave: 'justa', bloquea: false })]);
    });
    it('un color plano bloquea y no se acusa además de borrosa', () => {
        expect(claves({ ancho: 800, alto: 800, nitidez: 0, contraste: 1 })).toEqual(['vacia']);
    });
    it('desenfocada avisa', () => expect(claves({ ancho: 800, alto: 800, nitidez: 10, contraste: 40 })).toEqual(['borrosa']));
    it('sin medición de nitidez no se inventa el aviso', () => expect(claves({ ancho: 800, alto: 800 })).toEqual([]));
});
