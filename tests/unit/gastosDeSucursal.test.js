import { describe, expect, it } from 'vitest';
import { estadoDeServicio, gastosPorMes, serviciosDeSucursal, totalOperativo, variacionDeGastos } from '@nucleo/utils/gastosDeSucursal';

const hoy = new Date(2026, 9, 6); // 6 de octubre de 2026

describe('gastosDeSucursal', () => {
    it('el estado de un servicio', () => {
        expect(estadoDeServicio(null, null, false, hoy).state).toBe('unknown');
        expect(estadoDeServicio(10, '2026-10', false, hoy).state).toBe('paid');
        expect(estadoDeServicio(10, '2026-09', false, hoy).state).toBe('pending');   // día 6, paga el 10
        expect(estadoDeServicio(5, '2026-09', false, hoy).state).toBe('expired');    // ya pasó el 5
        expect(estadoDeServicio(5, '2026-07', false, hoy).state).toBe('expired');
        expect(estadoDeServicio(5, '2026-09', true, hoy).state).toBe('pending_receipt');
    });
    it('servicios y total: el arrendamiento sólo si es alquilada; luz/agua/internet sólo en farmacia', () => {
        const b = { type: 'FARMACIA', settings: { propertyType: 'RENTED', rent: { amount: 500 }, services: { light: { amount: 80 }, phone: { amount: 20 } } } };
        expect(serviciosDeSucursal(b, hoy).map((x) => x.clave)).toEqual(['rent', 'light', 'water', 'internet', 'phone', 'taxes']);
        expect(totalOperativo(b)).toBe(600);
        const bodega = { type: 'BODEGA', settings: { services: { light: { amount: 80 }, phone: { amount: 20 } } } };
        expect(serviciosDeSucursal(bodega, hoy).map((x) => x.clave)).toEqual(['phone', 'taxes']);
        expect(totalOperativo(bodega)).toBe(20);
    });
    it('por mes y variación', () => {
        const h = gastosPorMes([{ billing_month: '2026-08', amount: 100 }, { billing_month: '2026-09', amount: 150 }, { billing_month: '2026-08', amount: 50 }]);
        expect(h.map((x) => x.total)).toEqual([150, 150]);
        expect(variacionDeGastos(h, {}).variation).toBe(0);
        expect(variacionDeGastos([{ total: 100 }, { total: 120 }], {}).isUp).toBe(true);
    });
});
