import { describe, expect, it } from 'vitest';
import { loteFundido, queFaltaAlCorregirLote } from '@nucleo/utils/libroBajoReceta';

// El juez que comparten el portal (TabLotesPorRevisar) y la app
// (bitacoras-lotes) al corregir el lote del libro bajo receta.
describe('loteFundido', () => {
    it('reconoce dos lotes en uno y el genérico', () => {
        expect(loteFundido('2603216_2603525')).toBe(true);
        expect(loteFundido('2603216 / 2603525')).toBe(true);
        expect(loteFundido(' generico ')).toBe(true);
        expect(loteFundido('A12345')).toBe(false);
        expect(loteFundido('')).toBe(false);
    });
});

describe('queFaltaAlCorregirLote', () => {
    const base = { cantidad: 2, vendidoVencido: false, fechaVenta: '2026-11-10' };

    it('dice qué fila y qué campo', () => {
        expect(queFaltaAlCorregirLote({ ...base, partes: [{ lote: '', vence: '', cantidad: '2' }] }))
            .toEqual({ texto: 'Escribe el lote.', campo: 'lote-0' });
        expect(queFaltaAlCorregirLote({ ...base, partes: [{ lote: 'L1', vence: '2027-01-01', cantidad: '1' }, { lote: 'A_B', vence: '', cantidad: '1' }] }))
            .toEqual({ texto: 'Escribe un solo lote por fila (lote 2).', campo: 'lote-1' });
        expect(queFaltaAlCorregirLote({ ...base, partes: [{ lote: 'L1', vence: '', cantidad: '2' }] }).campo).toBe('vence-0');
    });

    it('exige que la suma dé lo entregado', () => {
        expect(queFaltaAlCorregirLote({ ...base, partes: [{ lote: 'L1', vence: '2027-01-01', cantidad: '1' }] }))
            .toEqual({ texto: 'Las cantidades suman 1 y se entregaron 2.', campo: 'cantidad-0' });
    });

    it('vencido al vender exige marcarlo, y la marca exige un vencido', () => {
        const vencida = [{ lote: 'L1', vence: '2026-10-01', cantidad: '2' }];
        expect(queFaltaAlCorregirLote({ ...base, partes: vencida }).campo).toBe('vendidoVencido');
        expect(queFaltaAlCorregirLote({ ...base, partes: vencida, vendidoVencido: true })).toBeNull();
        expect(queFaltaAlCorregirLote({ ...base, partes: [{ lote: 'L1', vence: '2027-01-01', cantidad: '2' }], vendidoVencido: true }).campo)
            .toBe('vendidoVencido');
    });

    it('listo cuando todo cuadra', () => {
        expect(queFaltaAlCorregirLote({ ...base, partes: [{ lote: 'L1', vence: '2027-01-01', cantidad: '2' }] })).toBeNull();
    });
});
