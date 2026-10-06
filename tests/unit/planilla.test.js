import { describe, expect, it } from 'vitest';
import { montoEnLetras, numeroEnLetras, ordenDeCargo, partidasDeBoleta, rotuloDePeriodo, totalesDePlanilla } from '@nucleo/utils/planilla';

describe('planilla', () => {
    it('el monto en letras de la boleta', () => {
        expect(montoEnLetras(362.71)).toBe('TRESCIENTOS SESENTA Y DOS CON 71/100');
        expect(montoEnLetras(1000)).toBe('MIL CON 00/100');
        expect(numeroEnLetras(0)).toBe('cero');
        expect(numeroEnLetras(100)).toBe('cien');
        expect(numeroEnLetras(121)).toBe('ciento veintiuno');
        expect(numeroEnLetras(21000)).toBe('veintiún mil');
        expect(numeroEnLetras(1250)).toBe('mil doscientos cincuenta');
        expect(numeroEnLetras(31)).toBe('treinta y uno');
    });
    it('la quincena se nombra por su primer día', () => {
        expect(rotuloDePeriodo('2026-09-16', '2026-09-30')).toMatch(/^Segunda Quincena de/);
        expect(rotuloDePeriodo('2026-09-01', '2026-09-15')).toMatch(/^Primera Quincena de/);
    });
    it('los cargos más altos primero; uno desconocido al final', () => {
        expect(ordenDeCargo({ role_id: 2 })).toBe(0);
        expect(ordenDeCargo({ roleId: 999 })).toBe(999);
    });
    it('totales', () => {
        expect(totalesDePlanilla([{ net_pay: 10, total_deductions: 2, ordinary_salary: 12 }, { net_pay: '5' }])).toEqual({ personas: 2, liquido: 15, descuentos: 2, ordinario: 12 });
    });
});

describe('partidasDeBoleta', () => {
    it('convierte las horas en dinero con el sueldo por hora del papel', () => {
        // $600/mes → diario 20.00 → por hora 2.50
        const p = partidasDeBoleta({ extra_hours_diurnal: 3, night_hours_ordinary: 4, subtotal_a: 300, subtotal_b: 20, ordinary_salary: 300, days_worked: 15 }, 600);
        expect(p.porHora).toBe(2.5);
        const extra = p.noSujetos.find((x) => x.rotulo.startsWith('Horas extra diurnas'));
        expect(extra.horas).toBe(3);
        expect(extra.monto).toBe(15);
        expect(p.noSujetos.find((x) => x.rotulo.startsWith('Horas nocturnas ordinarias')).monto).toBe(2.5);
        expect(p.subtotalA).toBe(300);
        expect(p.subtotalB).toBe(20);
    });
    it('omite las partidas en cero', () => {
        const p = partidasDeBoleta({ ordinary_salary: 100 }, 300);
        expect(p.noSujetos).toEqual([]);
        expect(p.otrosDescuentos).toEqual([]);
    });
});
