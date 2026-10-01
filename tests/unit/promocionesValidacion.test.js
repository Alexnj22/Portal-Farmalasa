import { describe, it, expect } from 'vitest';
import { numeroEscrito, problemasDeLaPromocion, fmtLote } from '../../src/utils/promocionesUtils';

describe('numeroEscrito', () => {
    it('acepta coma decimal y espacios', () => {
        expect(numeroEscrito('1,5')).toBe(1.5);
        expect(numeroEscrito(' 12 ')).toBe(12);
        expect(numeroEscrito('0.25')).toBe(0.25);
    });
    it('no inventa un cero con lo que no es número', () => {
        expect(numeroEscrito('abc')).toBeNull();
        expect(numeroEscrito('1.2.3')).toBeNull();
        expect(numeroEscrito('')).toBeNull();
        expect(numeroEscrito(null)).toBeNull();
    });
});

describe('fmtLote', () => {
    it('sin lote es un guion, no un cero', () => {
        expect(fmtLote(null)).toBe('—');
        expect(fmtLote(undefined)).toBe('—');
    });
});

const base = {
    producto: 'LECHE X', inicio: '2026-10-01', fin: '2026-10-31', lote_total: '',
    tiene_bono: true, paga: 'empresa', supplier_id: '',
    bono_vendedor: '1.00', bono_adm: '0.25', bono_bodega: '0.25', unidades_por_bono: '1',
    salas: {}, reparto: {},
};

describe('problemasDeLaPromocion', () => {
    it('un renglón completo no tiene problemas', () => {
        expect(problemasDeLaPromocion([base])).toEqual([]);
    });
    it('el fin es obligatorio (NOT NULL en la base)', () => {
        expect(problemasDeLaPromocion([{ ...base, fin: '' }])[0]).toMatch(/fin/);
    });
    it('el fin no puede ser antes del inicio', () => {
        expect(problemasDeLaPromocion([{ ...base, fin: '2026-09-01' }])[0]).toMatch(/antes de empezar/);
    });
    it('proveedor obligatorio si paga un proveedor', () => {
        expect(problemasDeLaPromocion([{ ...base, paga: 'proveedor' }])[0]).toMatch(/proveedor/);
    });
    it('lote cero o con letras se rechaza; vacío vale', () => {
        expect(problemasDeLaPromocion([{ ...base, lote_total: '0' }])).toHaveLength(1);
        expect(problemasDeLaPromocion([{ ...base, lote_total: 'x' }])).toHaveLength(1);
        expect(problemasDeLaPromocion([{ ...base, lote_total: '' }])).toHaveLength(0);
    });
    it('bono con texto que no es monto', () => {
        expect(problemasDeLaPromocion([{ ...base, bono_vendedor: 'abc' }])[0]).toMatch(/vendedor/);
    });
    it('el reparto tiene que sumar el lote', () => {
        const r = { ...base, lote_total: '100', salas: { 1: true, 2: true }, reparto: { 1: '40', 2: '50' } };
        expect(problemasDeLaPromocion([r])[0]).toMatch(/no suma/);
        expect(problemasDeLaPromocion([{ ...r, reparto: { 1: '40', 2: '60' } }])).toEqual([]);
    });
    it('salas marcadas en 0 son válidas («aplica, sin lote»)', () => {
        expect(problemasDeLaPromocion([{ ...base, salas: { 1: true }, reparto: { 1: '' } }])).toEqual([]);
    });
    it('agrupa la misma falla de varios productos', () => {
        const l = problemasDeLaPromocion([{ ...base, fin: '' }, { ...base, producto: 'Y', fin: '' }]);
        expect(l).toEqual(['2 productos: falta la fecha de fin.']);
    });
});
