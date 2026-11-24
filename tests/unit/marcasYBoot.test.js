// La carrera entre la lectura de marcas y el boot (2026-11-24).
//
// Auditoría de tiempos pide las marcas al montarse, con el padrón del caché,
// mientras `fetchBoot` sigue en vuelo. Si la lectura terminaba primero, el
// boot reemplazaba el padrón con fichas de `attendance: []` y `attendanceLoaded`
// quedaba en true: 0 marcas y ninguna vista volvía a pedirlas.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@nucleo/supabaseClient', () => ({ supabase: {} }));
vi.mock('@nucleo/data/employees', async (orig) => ({
    ...(await orig()),
    fetchAttendanceSince: vi.fn(async () => ({
        data: [
            { id: 2, employee_id: 7, timestamp: '2026-11-20T15:00:00Z' },
            { id: 1, employee_id: 7, timestamp: '2026-11-20T12:00:00Z' },
            { id: 3, employee_id: 9, timestamp: '2026-11-21T12:00:00Z' },
        ],
        error: null,
    })),
}));

const { createEmployeeSlice, conservarMarcas } = await import('@nucleo/store/slices/employeeSlice');

function tienda(inicial) {
    let state = {};
    const set = (p) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; };
    const get = () => state;
    state = { ...createEmployeeSlice(set, get), ...inicial };
    return { set, get };
}

describe('las marcas sobreviven al boot', () => {
    it('lectura antes del boot: el padrón nuevo conserva las marcas', async () => {
        const t = tienda({ employees: [{ id: 7, attendance: [] }] });
        await t.get().loadAttendanceLastDays(62);
        expect(t.get().employees[0].attendance.map((a) => a.id)).toEqual([1, 2]);

        // Lo que hace fetchBoot al terminar: fichas nuevas, sin marcas.
        const delBoot = [{ id: 7, attendance: [] }, { id: 9, attendance: [] }];
        t.set((s) => ({ employees: conservarMarcas(delBoot, s) }));

        const porId = Object.fromEntries(t.get().employees.map((e) => [e.id, e.attendance.map((a) => a.id)]));
        expect(porId).toEqual({ 7: [1, 2], 9: [3] });
        expect(t.get().attendanceLoaded).toBe(true);
    });

    it('lectura con el padrón vacío: el boot las toma de la última lectura', async () => {
        const t = tienda({ employees: [] });
        await t.get().loadAttendanceLastDays(14);
        t.set((s) => ({ employees: conservarMarcas([{ id: 9, attendance: [] }], s) }));
        expect(t.get().employees[0].attendance.map((a) => a.id)).toEqual([3]);
    });

    it('sin lectura previa, el boot no inventa nada', () => {
        const nuevas = [{ id: 7, attendance: [] }];
        expect(conservarMarcas(nuevas, { attendanceLoaded: false, employees: [{ id: 7, attendance: [{ id: 1 }] }] })).toBe(nuevas);
    });

    it('una marca agregada después de leer no se pierde', () => {
        const s = {
            attendanceLoaded: true,
            marcasCargadas: { 7: [{ id: 1 }] },
            employees: [{ id: 7, attendance: [{ id: 1 }, { id: 99 }] }],
        };
        expect(conservarMarcas([{ id: 7, attendance: [] }], s)[0].attendance.map((a) => a.id)).toEqual([1, 99]);
    });
});
