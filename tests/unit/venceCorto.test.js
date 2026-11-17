import { describe, it, expect } from 'vitest';
import { mesesParaVencer, venceCorto, venceTexto } from '@nucleo/utils/venceCorto';

// Gemelo de `public.notificar_vence_corto`: el corte es por MES, hasta hoy + 6.
describe('venceCorto', () => {
    const hoy = '2026-11-17';
    it('cuenta meses de calendario', () => {
        expect(mesesParaVencer('2027-05', hoy)).toBe(6);
        expect(mesesParaVencer('2027-06-30', hoy)).toBe(7);
        expect(mesesParaVencer('2026-10', hoy)).toBe(-1);
    });
    it('entra hasta el mes de hoy + 6, y lo vencido también', () => {
        expect(venceCorto('2027-05', hoy)).toBe(true);
        expect(venceCorto('2027-06', hoy)).toBe(false);
        expect(venceCorto('2026-01', hoy)).toBe(true);
    });
    it('sin fecha completa no alerta', () => {
        expect(venceCorto('', hoy)).toBe(false);
        expect(venceCorto('2027-0', hoy)).toBe(false);
        expect(venceCorto(null, hoy)).toBe(false);
        expect(venceCorto('2027-13', hoy)).toBe(false);
    });
    it('texto mes/año', () => {
        expect(venceTexto('2027-05')).toBe('05/2027');
        expect(venceTexto('2027-05-01')).toBe('05/2027');
    });
});
