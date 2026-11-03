import { describe, expect, it } from 'vitest';
import { venceEfectivo, vencidoAlVender } from '@nucleo/utils/libroBajoReceta';

// Gemelo de `public.vence_efectivo`: el vencimiento del inventario es de MES.
describe('venceEfectivo', () => {
    it('un día 1 vale como el último día de su mes', () => {
        expect(venceEfectivo('2026-11-01')).toBe('2026-11-30');
        expect(venceEfectivo('2026-12-01')).toBe('2026-12-31');
        expect(venceEfectivo('2028-02-01')).toBe('2028-02-29');
        expect(venceEfectivo('2026-02-01')).toBe('2026-02-28');
    });
    it('cualquier otro día queda tal cual', () => {
        expect(venceEfectivo('2026-11-15')).toBe('2026-11-15');
        expect(venceEfectivo('2026-11-30')).toBe('2026-11-30');
    });
    it('sin fecha no inventa una', () => {
        expect(venceEfectivo(null)).toBe(null);
        expect(venceEfectivo('')).toBe(null);
    });
});

describe('vencidoAlVender', () => {
    it('«11/2026» se puede vender todo noviembre', () => {
        expect(vencidoAlVender('2026-11-01', '2026-11-02')).toBe(false);
        expect(vencidoAlVender('2026-11-01', '2026-11-30')).toBe(false);
        expect(vencidoAlVender('2026-11-01', '2026-12-01')).toBe(true);
    });
    it('un vencimiento del mes pasado sí está vencido', () => {
        expect(vencidoAlVender('2026-10-01', '2026-11-02')).toBe(true);
    });
    it('sin vencimiento no hay nada que acusar', () => {
        expect(vencidoAlVender(null, '2026-11-02')).toBe(false);
    });
});
