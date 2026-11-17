// Kiosco de caja (2026-11-17): el tope es por tipo. Hasta 3 marcadores y 1 caja.
import { describe, it, expect } from 'vitest';
import { cupoDeKioscos, kioscosActivos, tipoDeKiosco, TIPOS_DE_KIOSCO } from '@nucleo/utils/kioscos.js';

const lista = [
    { id: 1, status: 'ACTIVE' },                       // de antes: sin tipo = marcador
    { id: 2, status: 'ACTIVE', tipo: 'marcacion' },
    { id: 3, status: 'REVOKED', tipo: 'marcacion' },
    { id: 4, status: 'ACTIVE', tipo: 'caja' },
];

describe('kioscos por tipo', () => {
    it('un equipo sin tipo es marcador', () => {
        expect(tipoDeKiosco({})).toBe(TIPOS_DE_KIOSCO.MARCACION);
    });
    it('sin tipo, cuenta sólo marcadores activos (lo que contaban todos antes)', () => {
        expect(kioscosActivos(lista).map((k) => k.id)).toEqual([1, 2]);
    });
    it('null cuenta los dos tipos', () => {
        expect(kioscosActivos(lista, null).map((k) => k.id)).toEqual([1, 2, 4]);
    });
    it('el cupo de caja es 1 y ya está lleno', () => {
        expect(cupoDeKioscos(lista, 'caja')).toMatchObject({ activos: 1, limite: 1, lleno: true });
    });
    it('el cupo de marcadores sigue en 3', () => {
        expect(cupoDeKioscos(lista)).toMatchObject({ activos: 2, limite: 3, lleno: false, rotulo: '2 / 3' });
    });
});
