import { describe, expect, it } from 'vitest';
import { afluencia, horarioDeSala } from '@nucleo/utils/afluencia';

// 2026-09-28 y 2026-09-21 son lunes.
const filas = [
    { sale_date: '2026-09-28', sale_hour: 8, transaction_count: 10, total_sales: 100 },
    { sale_date: '2026-09-21', sale_hour: 8, transaction_count: 20, total_sales: 300 },
    { sale_date: '2026-09-21', sale_hour: 9, transaction_count: 6, total_sales: 50 },
    { sale_date: '2026-09-28', sale_hour: 3, transaction_count: 99, total_sales: 999 }, // fuera de horario
];

describe('afluencia', () => {
    it('días: venta promedio del día y fechas que entraron', () => {
        const { items, fechas } = afluencia(filas, null, { vista: 'dias' });
        const lunes = items.find((x) => x.dia === 1);
        expect(fechas).toBe(2);
        expect(lunes.ventas).toBe(225);           // (100 + 300 + 50) / 2
        expect(lunes.fechas).toEqual(['2026-09-21', '2026-09-28']);
        expect(items.find((x) => x.dia === 2).tickets).toBe(0);
    });
    it('horas de un día: promedio sobre las fechas de ese día', () => {
        const { items } = afluencia(filas, null, { vista: 1 });
        const ocho = items.find((x) => x.hora === 8);
        expect(ocho.tickets).toBe(15);
        expect(ocho.ventas).toBe(200);
    });
    it('hoy: sin promediar', () => {
        const hoy = filas.filter((f) => f.sale_date === '2026-09-21');
        const { items } = afluencia(hoy, null, { vista: 'horas', hoy: true });
        expect(items.find((x) => x.hora === 8).tickets).toBe(20);
        expect(items.find((x) => x.hora === 9).ventas).toBe(50);
    });
    it('el horario descarta días cerrados y acepta open/close', () => {
        const sala = { weekly_hours: {
            mon: { start: '08:00', end: '20:00' },
            sun: { isClosed: true, start: '05:00', end: '23:00' },
            sat: { open: '07:30', close: '21:00' },
        } };
        expect(horarioDeSala(sala)).toEqual({ openH: 7, closeH: 20 });
    });
});
