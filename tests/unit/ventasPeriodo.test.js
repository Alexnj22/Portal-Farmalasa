import { describe, expect, it } from 'vitest';
import { diasDelRango, horaDeCorte, mesEnCurso, periodoAnterior, renglonesDeLaVenta, variacionPorDia } from '@nucleo/utils/ventasPeriodo';

describe('ventasPeriodo', () => {
    it('mes en curso hasta hoy', () => {
        expect(mesEnCurso('2026-10-02')).toEqual({ fini: '2026-10-01', ffin: '2026-10-02', label: '2026-10' });
    });
    it('período anterior: corre tantos meses como abarca', () => {
        expect(periodoAnterior('2026-05-05', '2026-05-09')).toEqual({ prevFini: '2026-04-05', prevFfin: '2026-04-09' });
        expect(periodoAnterior('2026-05-01', '2026-07-31')).toEqual({ prevFini: '2026-02-01', prevFfin: '2026-04-30' });
        expect(periodoAnterior('2026-01-01', '2026-12-31')).toEqual({ prevFini: '2025-01-01', prevFfin: '2025-12-31' });
        expect(periodoAnterior('2026-03-31', '2026-03-31')).toEqual({ prevFini: '2026-02-28', prevFfin: '2026-02-28' });
    });
    it('días del rango y variación por día', () => {
        expect(diasDelRango('2026-10-01', '2026-10-01')).toBe(1);
        expect(diasDelRango('2026-02-01', '2026-03-01')).toBe(29);
        expect(variacionPorDia(300, 30, 310, 31)).toBeCloseTo(0, 5);
        expect(variacionPorDia(100, 10, 0, 10)).toBeNull();
    });
    it('hora de corte sólo si el rango termina hoy', () => {
        expect(horaDeCorte('2026-10-02', '2026-10-02', '14:37:51')).toBe('14:37:00');
        expect(horaDeCorte('2026-10-01', '2026-10-02', '14:37:51')).toBeNull();
    });
    it('renglones: sin duplicados, descuento por renglón o por diferencia', () => {
        const a = { erp_product_id: 1, descripcion: 'A', precio_unitario: 2, total_linea: 4, cantidad: 2 };
        expect(renglonesDeLaVenta([a, { ...a }], 4)).toEqual({ productos: [a], descuento: 0 });
        const d = { erp_product_id: -999, descripcion: 'DESC', total_linea: -1.5 };
        expect(renglonesDeLaVenta([a, d], 2.5).descuento).toBe(1.5);
        expect(renglonesDeLaVenta([a], 3).descuento).toBe(1);
        expect(renglonesDeLaVenta([a], 3.995).descuento).toBe(0);
    });
});
