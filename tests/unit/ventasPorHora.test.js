import { describe, expect, it } from 'vitest';
import { estadisticasDeVentaPorHora, nivelDeTransacciones } from '@nucleo/utils/ventasPorHora';

describe('ventasPorHora', () => {
    it('los niveles son los umbrales del portal', () => {
        expect(nivelDeTransacciones(19)).toBe('critica');
        expect(nivelDeTransacciones(13)).toBe('pico');
        expect(nivelDeTransacciones(5)).toBe('normal');
        expect(nivelDeTransacciones(4)).toBe('muerta');
    });
    it('promedia por fecha y recorta a las horas de apertura', () => {
        const filas = [
            { sale_date: '2026-10-05', sale_hour: 10, transaction_count: 20 },   // lunes
            { sale_date: '2026-09-28', sale_hour: 10, transaction_count: 40 },   // lunes
            { sale_date: '2026-10-05', sale_hour: 3, transaction_count: 99 },    // fuera de horario
        ];
        const r = estadisticasDeVentaPorHora(filas, null);
        const diez = r.specificHours[1].find((h) => h.hour === 10);
        expect(diez.avg).toBe(30);
        expect(diez.nivel).toBe('critica');
        expect(diez.color).toBe('var(--txvol-critica)');
        expect(r.generalHours.some((h) => h.hour === 3)).toBe(false);
    });
});
