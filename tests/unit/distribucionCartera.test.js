import { describe, it, expect } from 'vitest';
import { repartirCobro, saldoAFavor, tramoDe, usoDelSaldoAFavor } from '@nucleo/utils/distribucionCartera';
import { leerMonto } from '@nucleo/utils/distribucionComun';

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

// El saldo a favor como pago parcial: los mismos frenos que
// `dist_aplicar_saldo_a_favor` (probados en el entorno de pruebas: 15 a favor,
// cuenta de 50 → se usan 5, quedan 10; pedir 46 sobre una cuenta de 45 frena).
describe('saldo a favor como pago parcial', () => {
    const uso = (aFavor, saldo, montoTexto = '') => usoDelSaldoAFavor({ aFavor, cuenta: saldo == null ? null : { id: 1, saldo }, montoTexto, leer: leerMonto });

    it('el tope es lo menor entre lo que tiene a favor y lo que debe la cuenta', () => {
        expect(uso(15, 50).tope).toBe(15);
        expect(uso(80, 45).tope).toBe(45);
        expect(uso(15, 50)).toMatchObject({ monto: 15, problema: null });
    });

    it('se puede usar por partes', () => {
        expect(uso(15, 50, '5')).toMatchObject({ monto: 5, problema: null });
    });

    it('no deja pasar de lo que tiene ni de lo que debe la cuenta', () => {
        expect(uso(15, 50, '16').problema).toMatch(/Sólo tiene/);
        expect(uso(80, 45, '46').problema).toMatch(/sólo debe/);
        expect(uso(15, null).problema).toMatch(/Elige/);
        expect(uso(0, 50).problema).toMatch(/No hay saldo/);
        expect(uso(15, 50, '0').problema).toMatch(/cuánto/);
    });

    it('un saldo negativo (nota invalidada después de usarla) se muestra como cero', () => {
        expect(saldoAFavor({ a_favor: -5 })).toBe(0);
        expect(saldoAFavor({ a_favor: '12.50' })).toBe(12.5);
        expect(saldoAFavor(null)).toBe(0);
    });
});
