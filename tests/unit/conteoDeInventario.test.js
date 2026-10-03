import { describe, expect, it } from 'vitest';
import { cantidadValida, conteoEditable, guardadoDelRenglon, noUbicado } from '@nucleo/utils/conteoDeInventario';

describe('conteoDeInventario', () => {
    it('se cuenta en borrador o en progreso', () => {
        expect(conteoEditable({ status: 'EN_PROGRESO' })).toBe(true);
        expect(conteoEditable({ status: 'FINALIZADO' })).toBe(false);
        expect(conteoEditable(null)).toBe(false);
    });
    it('cantidad: entero de 0 o más, o vacía', () => {
        expect(cantidadValida('')).toBe(true);
        expect(cantidadValida('0')).toBe(true);
        expect(cantidadValida('3.5')).toBe(false);
        expect(cantidadValida(-1)).toBe(false);
    });
    it('vacío deja pendiente; un número, contado; no ubicado aparte', () => {
        expect(guardadoDelRenglon('', ' ')).toEqual({ fisicoCantidad: null, nota: null, estadoItem: 'PENDIENTE' });
        expect(guardadoDelRenglon('9', 'repisa 2')).toEqual({ fisicoCantidad: 9, nota: 'repisa 2', estadoItem: 'CONTADO' });
        expect(noUbicado()).toEqual({ fisicoCantidad: 0, nota: null, estadoItem: 'SIN_UBICAR' });
    });
});
