import { describe, expect, it } from 'vitest';
import { montoEnLetras, numeroEnLetras, ordenDeCargo, rotuloDePeriodo, totalesDePlanilla } from '@nucleo/utils/planilla';

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
