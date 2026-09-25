import { describe, it, expect } from 'vitest';
import casos from '../casos-busqueda.json';
import {
    normalizar, coincide, puntaje, parecido, filtrar, fonetica, patronSinTildes,
    UMBRAL_APROXIMADA,
} from '../../src/utils/busqueda';

// Los casos viven en JSON y no acá porque valen también para el gemelo SQL:
// un caso escrito sólo para JS es un caso que el otro gemelo nunca enfrenta.

describe('normalizar', () => {
    it.each(casos.normalizar)('$entrada', ({ entrada, salida }) => {
        expect(normalizar(entrada)).toBe(salida);
    });
});

describe('coincide', () => {
    it.each(casos.coincide)('«$consulta» en «$texto» → $esperado', ({ consulta, texto, esperado }) => {
        expect(coincide(consulta, texto)).toBe(esperado);
    });

    it('coincide en cualquiera de los campos, y las palabras pueden repartirse', () => {
        expect(coincide('losartan mk', 'LOSARTAN 50 MG', 'MK')).toBe(true);
        expect(coincide('losartan saimed', 'LOSARTAN 50 MG', 'MK')).toBe(false);
    });

    it('un campo nulo no rompe', () => {
        expect(coincide('gravol', null, undefined, 'GRAVOL')).toBe(true);
    });
});

describe('orden por relevancia', () => {
    it.each(casos.orden)('«$consulta»', ({ consulta, lista, primeros, ultimos }) => {
        const { resultados, aproximado } = filtrar(consulta, lista, s => [s]);
        expect(aproximado).toBe(false);
        expect(resultados.slice(0, primeros.length)).toEqual(primeros);
        expect(resultados.slice(-ultimos.length)).toEqual(ultimos);
    });

    it('a igual puntaje conserva el orden de la lista', () => {
        const lista = ['GRAVOL B', 'GRAVOL A'];
        expect(filtrar('gravol', lista, s => [s]).resultados).toEqual(lista);
    });

    it("'original' no reordena: los historiales siguen por fecha", () => {
        const lista = ['NASAL', 'SAL ANDREWS'];
        expect(filtrar('sal', lista, s => [s], { orden: 'original' }).resultados).toEqual(lista);
    });

    it('los niveles del puntaje', () => {
        expect(puntaje('7501234567890', '7501234567890')).toBe(100);
        expect(puntaje('sal', 'SAL ANDREWS')).toBe(95);
        expect(puntaje('sal', 'SALBUTAMOL 4MG')).toBe(85);
        expect(puntaje('and sal', 'SAL ANDREWS')).toBe(80);
        expect(puntaje('asal', 'NASAL ASALI')).toBe(80);
        expect(puntaje('nasal', 'SPRAY NASAL')).toBe(90);
        expect(puntaje('pray nas', 'SPRAY NASAL')).toBe(70);
        expect(puntaje('asal', 'SPRAY NASAL')).toBe(60);
        expect(puntaje('xyz', 'SPRAY NASAL')).toBe(0);
    });
});

describe('puntaje con varios campos', () => {
    it.each(casos.puntaje)('«$consulta» en $campos → $esperado', ({ consulta, campos, esperado }) => {
        expect(puntaje(consulta, ...campos)).toBe(esperado);
    });
});

describe('aproximada', () => {
    it.each(casos.aproximada)('«$consulta» ≈ «$texto» → $esperado', ({ consulta, texto, esperado }) => {
        expect(parecido(consulta, texto) >= UMBRAL_APROXIMADA).toBe(esperado);
    });

    it('sólo entra si lo exacto no encontró nada, y avisa', () => {
        const lista = ['AMOXICILINA 500 MG', 'OMEPRAZOL 20 MG'];
        const r = filtrar('amoxisilina', lista, s => [s]);
        expect(r.aproximado).toBe(true);
        expect(r.resultados).toEqual(['AMOXICILINA 500 MG']);

        const exacto = filtrar('amoxicilina', lista, s => [s]);
        expect(exacto.aproximado).toBe(false);
    });

    it('la fonética iguala lo que suena igual', () => {
        expect(fonetica('amoxisilina')).toBe(fonetica('amoxicilina'));
        expect(fonetica('omeprasol')).toBe(fonetica('omeprazol'));
        expect(fonetica('vitamina')).toBe(fonetica('bitamina'));
        expect(fonetica('hierro')).toBe(fonetica('ierro'));
    });
});

describe('patronSinTildes (para imatch de PostgREST)', () => {
    it('una palabra sin tildes encuentra la escrita con tildes, y al revés', () => {
        const re = (p) => new RegExp(patronSinTildes(p), 'i');
        expect(re('jose').test('JOSÉ PÉREZ')).toBe(true);
        expect(re('José').test('JOSE PEREZ')).toBe(true);
        expect(re('nunez').test('NÚÑEZ')).toBe(true);
        expect(re('perez').test('PAREZ')).toBe(false);
    });
    it('la puntuación no viaja: no hay comodines que escapar', () => {
        expect(patronSinTildes('s.a.')).toBe('s[aáàâäAÁÀÂÄ]');
    });
});
