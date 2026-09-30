import { describe, expect, it } from 'vitest';
import { presentesEl, problemaDeSucursal, saludoDeLaHora, ventasPorSala } from '@nucleo/utils/inicio';

describe('inicio', () => {
    it('cuenta presentes una vez por persona y por sala', () => {
        const emps = [
            { id: 1, branchId: 4, attendance: [{ timestamp: '2026-09-30T08:00:00' }, { timestamp: '2026-09-30T12:00:00' }] },
            { id: 2, branch_id: 5, attendance: [{ date: '2026-09-30' }] },
            { id: 3, branchId: 4, attendance: [{ date: '2026-09-29' }] },
        ];
        expect(presentesEl(emps, '2026-09-30')).toBe(2);
        expect(presentesEl(emps, '2026-09-30', 4)).toBe(1);
    });

    it('agrupa ventas por sala y por hora', () => {
        const v = ventasPorSala([
            { branch_id: 4, sale_hour: 8, total_sales: '10.5', transaction_count: 2 },
            { branch_id: 4, sale_hour: 9, total_sales: 20, transaction_count: 3 },
            { branch_id: 5, sale_hour: 8, total_sales: 50, transaction_count: 1 },
        ]);
        expect(v[0]).toMatchObject({ branchId: '5', total: 50, tickets: 1 });
        expect(v[1].total).toBeCloseTo(30.5);
        expect(v[1].porHora[1]).toBe(10.5);
    });

    it('alerta de sucursal y saludo', () => {
        expect(problemaDeSucursal({ address: 'x', phone: '1' })).toBeNull();
        expect(problemaDeSucursal({ phone: '1' })).toBe('Sin dirección registrada');
        expect(saludoDeLaHora(new Date(2026, 8, 30, 9))).toBe('Buenos días');
        expect(saludoDeLaHora(new Date(2026, 8, 30, 15))).toBe('Buenas tardes');
    });
});
