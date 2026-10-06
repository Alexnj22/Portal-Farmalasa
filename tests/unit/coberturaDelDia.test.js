import { describe, expect, it } from 'vitest';
import { evaluarCoberturaDelDia } from '@nucleo/utils/coberturaDelDia';

const dia = (inicio, fin, almuerzo) => ({ 1: { customStart: inicio, customEnd: fin, ...(almuerzo ? { hasLunch: true, lunchStart: almuerzo } : {}) }, name: 'X' });

describe('evaluarCoberturaDelDia', () => {
    it('sin nadie que trabaje no avisa nada', () => {
        expect(evaluarCoberturaDelDia(1, [], [], [])).toEqual({ huecosCriticos: [], avisos: [] });
    });
    it('una hora de mucha venta con menos de tres personas es un hueco', () => {
        const r = evaluarCoberturaDelDia(1, [{ ...dia('08:00', '16:00'), name: 'Ana' }], [], [{ hour: 10, color: 'var(--txvol-critica)' }]);
        expect(r.huecosCriticos).toHaveLength(1);
    });
    it('el almuerzo que deja a una sola persona avisa', () => {
        const r = evaluarCoberturaDelDia(1, [{ ...dia('08:00', '16:00', '12:00'), name: 'Ana' }, { ...dia('08:00', '16:00'), name: 'Beto' }], [], []);
        expect(r.avisos).toHaveLength(1);
        expect(r.avisos[0].tipo).toBe('warning');
        expect(r.avisos[0].texto).toContain('Beto');
    });
});
