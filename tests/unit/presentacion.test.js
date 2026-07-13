import { describe, it, expect } from 'vitest';
import { applyPresRule } from '../../src/utils/presentacion';

// Regresión: extraído de TabMinMax.jsx — reglas de negocio que ya rompieron
// en producción (ver PLAN-EJECUCION-2026-07.md, Bloque 2). Convierte
// unidades sueltas a presentaciones (packs/cajas) con la regla del 40%:
// floor(units/factor) + (residuo/factor >= 0.4 ? 1 : 0).
describe('applyPresRule', () => {
    it('sin agrupación (factor <= 1) devuelve las unidades sin tocar', () => {
        expect(applyPresRule(37, 1)).toBe(37);
        expect(applyPresRule(37, 0)).toBe(37);
    });

    it('unidades en 0 o negativas devuelve 0', () => {
        expect(applyPresRule(0, 10)).toBe(0);
        expect(applyPresRule(null, 10)).toBe(0);
        expect(applyPresRule(undefined, 10)).toBe(0);
    });

    it('residuo por debajo del 40% redondea hacia abajo', () => {
        // 22/10 → 2 packs completos + residuo 2 (20% del factor) → no suma
        expect(applyPresRule(22, 10)).toBe(2);
        expect(applyPresRule(23, 10)).toBe(2); // 30%, todavía por debajo
    });

    it('residuo exactamente en el 40% redondea hacia arriba', () => {
        // 24/10 → 2 packs + residuo 4 (exactamente 40% del factor) → suma 1
        expect(applyPresRule(24, 10)).toBe(3);
    });

    it('residuo por encima del 40% redondea hacia arriba', () => {
        expect(applyPresRule(28, 10)).toBe(3); // 80%
    });

    it('múltiplo exacto del factor no agrega residuo', () => {
        expect(applyPresRule(30, 10)).toBe(3);
    });
});
