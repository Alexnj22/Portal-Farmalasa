import { describe, it, expect } from 'vitest';
import { faltaDelLibro, libroIncompleto, filasCsvBitacora, CABECERA_CSV_BITACORA } from '@nucleo/utils/inyeccionesPendientes';

// El libro de inyectables (2026-11-13): lo que exige `inyeccion_libro_guardar`.
const completo = { documento: '01234567-8', edad: '34', via: 'IM', sitio: 'Glúteo', reaccion: 'Sin reacción' };
const ampolla = { lote: 'L1', vence: '2027-05-01', dosis_ml: 3 };

describe('faltaDelLibro', () => {
    it('nada falta con el libro y la ampolla completos', () => {
        expect(faltaDelLibro(completo, ampolla)).toEqual([]);
        expect(libroIncompleto(completo, ampolla)).toBe(false);
    });
    it('la ampolla puede venir del formulario', () => {
        expect(faltaDelLibro({ ...completo, ...ampolla, dosis_ml: '3' }, {})).toEqual([]);
    });
    it('dice qué falta, en palabras', () => {
        expect(faltaDelLibro({ documento: 'x' }, {})).toEqual(['edad', 'vía', 'sitio', 'reacción', 'lote', 'vencimiento', 'dosis']);
    });
    it('edad 0 es una edad (un bebé)', () => {
        expect(faltaDelLibro({ ...completo, edad: 0 }, ampolla)).toEqual([]);
    });
    it('sin libro, está incompleto', () => {
        expect(libroIncompleto(undefined, ampolla)).toBe(true);
    });
});

describe('CSV del libro', () => {
    it('cada fila tiene tantas columnas como la cabecera', () => {
        const filas = filasCsvBitacora([{ id: 1, producto: 'X', precio: 1 }], { 1: { ...completo, edad: 34, firmado: true } });
        expect(filas[0]).toHaveLength(CABECERA_CSV_BITACORA.length);
        expect(filas[0].slice(-3)).toEqual([34, 'Sin reacción', 'SI']);
    });
});
