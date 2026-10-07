import { describe, it, expect } from 'vitest';
import { cupoDeKioscos, kioscosActivos, LIMITE_KIOSCOS, sucursalLlevaKiosco } from '@nucleo/utils/kioscos';

describe('kioscos de una sucursal', () => {
    const lista = [
        { id: 1, status: 'ACTIVE' },
        { id: 2, status: 'REVOKED' },
        { id: 3, status: 'ACTIVE' },
    ];

    it('sólo cuentan los vinculados', () => {
        expect(kioscosActivos(lista).map((k) => k.id)).toEqual([1, 3]);
        expect(kioscosActivos(null)).toEqual([]);
    });

    it('el cupo dice N / 3 y se llena en el tope', () => {
        expect(cupoDeKioscos(lista)).toMatchObject({ activos: 2, limite: LIMITE_KIOSCOS, lleno: false, rotulo: '2 / 3' });
        expect(cupoDeKioscos([...lista, { id: 4, status: 'ACTIVE' }]).lleno).toBe(true);
    });

    it('sólo farmacias y bodega llevan kiosco', () => {
        expect(sucursalLlevaKiosco('FARMACIA')).toBe(true);
        expect(sucursalLlevaKiosco('BODEGA')).toBe(true);
        expect(sucursalLlevaKiosco('OFICINA')).toBe(false);
    });
});
