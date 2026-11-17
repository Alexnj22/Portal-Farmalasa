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

import { esTicketDeVinculacion } from '@nucleo/utils/kioscos';
import { construirTicketDeVinculacion } from '@nucleo/utils/ticketDeVinculacion';

describe('ticket de vinculación', () => {
    it('reconoce el código que genera la base, con o sin minúsculas', () => {
        expect(esTicketDeVinculacion('KV7MP4XNQ2RH')).toBe(true);
        expect(esTicketDeVinculacion('kv7mp4xnq2rh')).toBe(true);
    });
    it('no confunde un carné ni la llave por hora', () => {
        expect(esTicketDeVinculacion('12345')).toBe(false);
        expect(esTicketDeVinculacion('2785GEOFLS')).toBe(false);
        expect(esTicketDeVinculacion('KV7MP4XNQ2R0')).toBe(false); // 0 no está en el alfabeto
    });
    it('el papel lleva el código en barras y dice qué equipo será', () => {
        const t = construirTicketDeVinculacion({ codigo: 'KV7MP4XNQ2RH', tipo: 'caja', sala: 'Salud 4', venceAt: '2026-11-17T17:00:00Z' });
        expect(t.codigos[0]).toMatchObject({ valor: 'KV7MP4XNQ2RH', simbologia: 'CODE128' });
        expect(t.encabezado.lineas).toEqual(['Kiosco de caja', 'Salud 4']);
    });
});
