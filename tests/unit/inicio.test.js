import { describe, expect, it } from 'vitest';
import { conTodasLasSalas, nivelDeVolumen, presentesEl, problemaDeSucursal, saludoDeLaHora, promediosDeVentas, ventasPorSala } from '@nucleo/utils/inicio';

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
        // En el orden del negocio, no por venta: Salud 1 (4) antes que una
        // sala fuera del mapa (5), aunque ésta venda más.
        expect(v[0].branchId).toBe('4');
        expect(v[0].total).toBeCloseTo(30.5);
        expect(v[0].porHora[1]).toBe(10.5);
        expect(v[1]).toMatchObject({ branchId: '5', total: 50, tickets: 1 });
    });

    it('alerta de sucursal y saludo', () => {
        expect(problemaDeSucursal({ address: 'x', phone: '1' })).toBeNull();
        expect(problemaDeSucursal({ phone: '1' })).toBe('Sin dirección registrada');
        expect(saludoDeLaHora(new Date(2026, 8, 30, 9))).toBe('Buenos días');
        expect(saludoDeLaHora(new Date(2026, 8, 30, 15))).toBe('Buenas tardes');
    });
});

describe('conTodasLasSalas', () => {
    it('agrega en cero las salas que venden y hoy no han vendido', () => {
        const hoy = [{ branchId: '4', total: 10, tickets: 2, porHora: [], ticketsPorHora: [] }];
        const r = conTodasLasSalas(hoy, [4, 2], { desde: 7, hasta: 9 });
        // La Popular (2) primero, después Salud 1 (4): el orden del negocio.
        expect(r.map((s) => s.branchId)).toEqual(['2', '4']);
        expect(r[0]).toMatchObject({ total: 0, tickets: 0, porHora: [0, 0, 0] });
    });
});

describe('nivelDeVolumen', () => {
    it('sigue la escala del tablero', () => {
        expect([0, 4, 5, 12, 13, 18, 19].map(nivelDeVolumen))
            .toEqual(['muerta', 'muerta', 'normal', 'normal', 'pico', 'pico', 'critica']);
    });
});

describe('promediosDeVentas', () => {
    // 2026-09-28 y 2026-09-21 son lunes.
    const filas = [
        { sale_date: '2026-09-28', sale_hour: 8, transaction_count: 10 },
        { sale_date: '2026-09-21', sale_hour: 8, transaction_count: 20 },
        { sale_date: '2026-09-28', sale_hour: 3, transaction_count: 99 }, // fuera de horario
    ];
    it('promedia por día de la semana y por hora, sólo dentro del horario', () => {
        const p = promediosDeVentas(filas, null);
        expect(p.openH).toBe(7);
        expect(p.closeH).toBe(18);
        expect(p.diasConDatos).toBe(2);
        expect(p.porDia[1].find((h) => h.hour === 8).avg).toBe(15);
        expect(p.horas.find((h) => h.hour === 8).avg).toBe(15);
        expect(p.dias.find((d) => d.day === 2).avg).toBe(0);
    });
    it('toma el horario de la sala', () => {
        const sala = { weekly_hours: { mon: { isOpen: true, start: '08:00', end: '20:00' } } };
        const p = promediosDeVentas([], sala);
        expect([p.openH, p.closeH]).toEqual([8, 19]);
    });
});
