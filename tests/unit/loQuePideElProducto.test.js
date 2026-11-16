import { describe, it, expect } from 'vitest';
import { faltaDelRenglon, rotuloDeLoQuePide } from '@nucleo/utils/conteoDeInventario';

// Lo que la lista del conteo dice de cada producto (2026-11-16): regulado →
// lote y vence; sólo perecedero → vence; ninguno → sólo cantidad.
describe('rotuloDeLoQuePide', () => {
    it('sigue la regla de la base', () => {
        expect(rotuloDeLoQuePide({ regulado: true, perecedero: false })).toBe('Pide lote y vence');
        expect(rotuloDeLoQuePide({ regulado: true, perecedero: true })).toBe('Pide lote y vence');
        expect(rotuloDeLoQuePide({ regulado: false, perecedero: true })).toBe('Pide solo vence');
        expect(rotuloDeLoQuePide({ regulado: false, perecedero: false })).toBe('Solo cantidad');
    });
    it('sin el dato no dice nada', () => {
        expect(rotuloDeLoQuePide({})).toBeNull();
        expect(rotuloDeLoQuePide(null)).toBeNull();
    });
});

describe('faltaDelRenglon', () => {
    const reg = { regulado: true, perecedero: false };
    const per = { regulado: false, perecedero: true };
    const nada = { regulado: false, perecedero: false };
    it('regulado sin lote: falta lote', () => {
        expect(faltaDelRenglon({ lote: 'GENERICO', fecha_vencimiento: null }, reg)).toBe('Falta lote');
        expect(faltaDelRenglon({ lote: null }, reg)).toBe('Falta lote');
    });
    it('regulado con lote y sin fecha: falta vence', () => {
        expect(faltaDelRenglon({ lote: 'L1', fecha_vencimiento: null }, reg)).toBe('Falta vence');
        expect(faltaDelRenglon({ lote: 'L1', fecha_vencimiento: '2027-05-01' }, reg)).toBeNull();
    });
    it('perecedero: sólo el vence', () => {
        expect(faltaDelRenglon({ lote: 'GENERICO', fecha_vencimiento: null }, per)).toBe('Falta vence');
        expect(faltaDelRenglon({ lote: 'GENERICO', fecha_vencimiento: '2027-05-01' }, per)).toBeNull();
    });
    it('ninguno: nada falta', () => {
        expect(faltaDelRenglon({ lote: 'GENERICO', fecha_vencimiento: null }, nada)).toBeNull();
    });
    it('sin el dato: no marca nada', () => {
        expect(faltaDelRenglon({ lote: null }, {})).toBeNull();
    });
});
