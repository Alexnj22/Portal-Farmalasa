import { describe, expect, it } from 'vitest';
import { COLUMNAS_DE_PRECIO, nivelesVisibles } from '@nucleo/utils/preciosDeProducto';

describe('preciosDeProducto', () => {
    it('hasta el tope del cargo, incluido', () => {
        expect(nivelesVisibles('vip').map((n) => n.key)).toEqual(['vineta', 'descuento_1', 'vip']);
    });
    it('sin tope, o con un tope que no es nivel, todos', () => {
        expect(nivelesVisibles(null).length).toBe(7);
        expect(nivelesVisibles('inventado').length).toBe(7);
    });
    it('las columnas para el select', () => {
        expect(COLUMNAS_DE_PRECIO).toBe('vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7');
    });
});
