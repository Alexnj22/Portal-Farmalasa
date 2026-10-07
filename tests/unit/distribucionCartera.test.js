import { describe, it, expect } from 'vitest';
import { repartirCobro, tramoDe } from '@nucleo/utils/distribucionCartera';

// El reparto de la pantalla tiene que dar lo mismo que `dist_cobrar` (0014):
// primero lo que vence antes. Los mismos casos se corrieron contra la base.
const cuentas = [
    { id: 57, estado: 'abierta', vence: '2026-10-19', saldo: 649.37 },
    { id: 55, estado: 'abierta', vence: '2026-10-01', saldo: 59.40 },
    { id: 60, estado: 'pagada', vence: '2026-09-01', saldo: 0 },
];

describe('cartera: reparto de un cobro', () => {
    it('primero lo que vence antes, como la base', () => {
        const { reparto, sobra } = repartirCobro(cuentas, 100);
        expect(reparto).toEqual([
            { cxc_id: 55, monto: 59.4, saldo: 59.4, queda: 0 },
            { cxc_id: 57, monto: 40.6, saldo: 649.37, queda: 608.77 },
        ]);
        expect(sobra).toBe(0);
    });
    it('no reparte más de lo que se debe: lo que sobra se dice', () => {
        const { reparto, sobra } = repartirCobro(cuentas, 1000);
        expect(reparto.reduce((a, r) => a + r.monto, 0)).toBeCloseTo(708.77, 2);
        expect(sobra).toBeCloseTo(291.23, 2);
    });
    it('en centavos: 0.1 + 0.2 no deja un centavo colgando', () => {
        const { reparto } = repartirCobro([{ id: 1, estado: 'abierta', vence: '2026-01-01', saldo: 0.3 }], 0.1 + 0.2);
        expect(reparto[0].queda).toBe(0);
    });
    it('los tramos de antigüedad cortan donde la base', () => {
        expect([0, -3, 1, 30, 31, 60, 61, 90, 91].map(tramoDe)).toEqual(['al_dia', 'al_dia', '1_30', '1_30', '31_60', '31_60', '61_90', '61_90', 'mas_90']);
    });
});
