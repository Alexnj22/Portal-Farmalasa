import { describe, it, expect } from 'vitest';
import { formatearNit, formatearNrc } from '../../src/utils/nitUtils';

// Los casos salen de `customers.nit` en producción (2026-08-02): 52 filas con el
// NIT clásico bien formado, 29 con un NIT de 9 dígitos vestido con la máscara de
// 14 —que es lo que producía `0177-7948--2` en el libro de contribuyentes— y 1
// bien puesto.

describe('formatearNit', () => {
    it('9 dígitos van con formato de DUI, que es lo que son', () => {
        expect(formatearNit('0177-7948--2')).toBe('01777948-2');
        expect(formatearNit('0539-1795--5')).toBe('05391795-5');
        expect(formatearNit('02677302--9')).toBe('02677302-9');
        expect(formatearNit('0140-5740-9')).toBe('01405740-9');
    });

    it('el que ya estaba bien no se toca', () => {
        expect(formatearNit('01274208-2')).toBe('01274208-2');
    });

    it('14 dígitos conservan el formato clásico MMMM-DDMMAA-NNN-V', () => {
        expect(formatearNit('0207-300784-106-4')).toBe('0207-300784-106-4');
        expect(formatearNit('06141007840010')).toBe('0614-100784-001-0');
    });

    it('lo que no tiene 9 ni 14 dígitos se devuelve tal cual', () => {
        // Inventarle una máscara a un número que no la tiene disimula que está
        // mal. `111` es el NIT de PHARMALAND en el ERP y tiene que verse feo.
        expect(formatearNit('111')).toBe('111');
        expect(formatearNit('0614160758')).toBe('0614160758');
        expect(formatearNit('')).toBe('');
        expect(formatearNit(null)).toBe('');
    });
});

describe('formatearNrc', () => {
    it('separa el verificador', () => {
        expect(formatearNrc('3544467')).toBe('354446-7');
        expect(formatearNrc('354446-7')).toBe('354446-7');
        expect(formatearNrc('1660')).toBe('166-0');
    });

    it('no rompe con valores cortos ni vacíos', () => {
        expect(formatearNrc('')).toBe('');
        expect(formatearNrc(null)).toBe('');
        expect(formatearNrc('7')).toBe('7');
    });
});
