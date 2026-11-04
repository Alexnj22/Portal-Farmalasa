import { describe, it, expect } from 'vitest';
import { coincideConControl, fechaCercana } from '../../supabase/functions/_shared/numeroDeControl.ts';

describe('coincideConControl', () => {
    const control = 'DTE-03-M001P001-000000000020680';

    it('el recorte que sólo deja ceros es «prefijo», no identifica (COFARSAL, 14 falsas)', () => {
        expect(coincideConControl(control, 'DTE-03-M001P001-0000')).toBe('prefijo');
    });
    it('con prefijo, sólo la compra cercana a la emisión (6391 sí, 6381 y las de 2025 no)', () => {
        expect(fechaCercana('2026-10-24', '2026-10-26')).toBe(true);
        expect(fechaCercana('2026-10-30', '2026-10-22')).toBe(false);
        expect(fechaCercana('2026-10-30', '2025-08-05')).toBe(false);
        expect(fechaCercana('2026-10-30', '2026-12-15')).toBe(false);
    });
    it('el correlativo solo SÍ (compra 6482, «20680»)', () => {
        expect(coincideConControl(control, '20680')).toBe('correlativo');
        expect(coincideConControl(control, '000000000020680')).toBe('correlativo');
    });
    it('un recorte que alcanza cifras del correlativo SÍ', () => {
        const largo = 'DTE-03-0000001A-000000000001234';
        expect(coincideConControl(largo, 'DTE-03-0000001A-0000')).toBe('prefijo');
        // 20 caracteres de un control con serie más corta llegan al correlativo.
        expect(coincideConControl('DTE-03-AB-0000012345', 'DTE-03-AB-0000012345')).toBe('control');
        expect(coincideConControl('DTE-03-AB-000001234567', 'DTE-03-AB-0000012345')).toBe('control');
    });
    it('otro correlativo no', () => {
        expect(coincideConControl(control, '20681')).toBe(null);
        expect(coincideConControl('DTE-03-AB-000001234567', 'DTE-03-AB-0000099999')).toBe(null);
    });
    it('vacíos', () => {
        expect(coincideConControl('', '20680')).toBe(null);
        expect(coincideConControl(control, '')).toBe(null);
    });
});
