import { describe, expect, it } from 'vitest';
import { causaDeCorteZ, cuadraZ, documentosQueDifieren, totalesCorteZ } from '@nucleo/utils/corteZ';

describe('corteZ', () => {
    it('cuadra por debajo de medio centavo', () => {
        expect(cuadraZ(0.004)).toBe(true);
        expect(cuadraZ(-0.004)).toBe(true);
        expect(cuadraZ(0.01)).toBe(false);
        expect(cuadraZ(null)).toBe(true);
    });
    it('los totales suman las ventas gravadas y cuentan las que difieren', () => {
        const t = totalesCorteZ([{ z_total: 100, z_factura: 90, z_ccf: 10, dif_total: 0 }, { z_total: 50, z_factura: 50, z_ccf: 0, dif_total: 9 }]);
        expect(t).toEqual({ total: 150, factura: 140, ccf: 10, difieren: 1, sucursales: 2 });
    });
    it('los documentos que difieren llevan la fecha de su hallazgo', () => {
        const r = documentosQueDifieren({ hallazgos: [{ fecha: '2026-07-03', sin_explicar: -2, documentos: [{ causa: 'sin_sello', impacto: 9 }] }] });
        expect(r.docs).toEqual([{ causa: 'sin_sello', impacto: 9, fecha: '2026-07-03' }]);
        expect(r.sinExplicar).toBe(2);
        expect(documentosQueDifieren({})).toEqual({ docs: [], sinExplicar: 0 });
    });
    it('una causa desconocida se explica como sin clasificar', () => {
        expect(causaDeCorteZ('nueva').que).toBe('Sin causa determinada');
    });
});
