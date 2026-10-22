// La lógica pura detrás de los arreglos de la auditoría de inventario, conteos,
// pedidos, traslados y el tablero (2026-10-21). Cada caso es el escenario que
// el hallazgo describía: el defecto no daba error, daba un número o una fila
// equivocada.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@nucleo/supabaseClient', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

const { lotesDistintos } = await import('@nucleo/data/conteoInventario');
const { recortarEnviosCerrados } = await import('@nucleo/data/envios');
const { numeroDelMesPorSala } = await import('@nucleo/data/accionesDePedido');
const { ausenciaCubreElDia, ausenciasDelDia } = await import('@nucleo/utils/inicio');

describe('lotesDistintos (alta manual a un conteo)', () => {
    it('un mismo número con dos vencimientos son DOS lotes', () => {
        const r = lotesDistintos([
            { lote: 'L31800', fecha_vencimiento: '2027-03-01' },
            { lote: 'L31800', fecha_vencimiento: '2028-01-01' },
            { lote: 'L31800', fecha_vencimiento: '2027-03-01' }, // otra presentación del mismo lote
        ]);
        expect(r).toEqual([
            { clave: 'L31800|2027-03-01', lote: 'L31800', fecha: '2027-03-01' },
            { clave: 'L31800|2028-01-01', lote: 'L31800', fecha: '2028-01-01' },
        ]);
    });

    it('sin vencimiento sigue siendo un lote, y sin número no entra', () => {
        const r = lotesDistintos([{ lote: 'A1', fecha_vencimiento: null }, { lote: null, fecha_vencimiento: '2027-01-01' }]);
        expect(r).toEqual([{ clave: 'A1|', lote: 'A1', fecha: null }]);
        expect(lotesDistintos(null)).toEqual([]);
    });
});

describe('recortarEnviosCerrados (historial de traslados)', () => {
    const env = (id, origen, destino, updated_at) => ({ id, origen_branch_id: origen, branch_id: destino, updated_at });
    const lista = [
        env('a', 4, 9, '2026-10-12T15:00:00Z'), // semana siguiente
        env('b', 4, 9, '2026-10-07T15:00:00Z'), // Salud 1 → otra, semana del 5
        env('c', 7, 4, '2026-10-06T15:00:00Z'), // otra → Salud 1, semana del 5
        env('d', 7, 8, '2026-10-06T10:00:00Z'), // ninguna de las dos es la sala
        env('e', 4, 9, '2026-09-30T15:00:00Z'), // semana anterior
    ];

    it('recorta por sala (los dos lados) y por la semana elegida', () => {
        const { envios, incompleto } = recortarEnviosCerrados(lista, { branchId: '4', semana: '2026-10-05' });
        expect(envios.map((e) => e.id)).toEqual(['b', 'c']);
        expect(incompleto).toBe(false);
    });

    it('sin sala ni semana no recorta nada', () => {
        expect(recortarEnviosCerrados(lista).envios).toHaveLength(5);
    });

    it('avisa si la consulta llegó a su techo sin pasar del comienzo de la semana', () => {
        const corta = [env('x', 4, 9, '2026-10-09T10:00:00Z'), env('y', 4, 9, '2026-10-08T10:00:00Z')];
        expect(recortarEnviosCerrados(corta, { semana: '2026-10-05', tope: 2 }).incompleto).toBe(true);
        // Si lo leído ya llega a antes de la semana, la semana está entera.
        expect(recortarEnviosCerrados(lista, { semana: '2026-10-05', tope: 5 }).incompleto).toBe(false);
    });
});

describe('numeroDelMesPorSala (código de sala del pedido)', () => {
    it('cuenta los pedidos previos del mes de cada sala, más uno', () => {
        const r = numeroDelMesPorSala([1, 2], [{ erp_sucursal_id: 1 }, { erp_sucursal_id: 1 }, { erp_sucursal_id: 3 }]);
        expect(r).toEqual({ 1: 3, 2: 1 });
    });
});

describe('ausenciaCubreElDia (ausentes del tablero)', () => {
    it('un permiso por días sueltos NO es un rango del primero al último', () => {
        const m = { permissionDates: ['2026-10-01', '2026-10-30'] };
        expect(ausenciaCubreElDia(m, '2026-10-01')).toBe(true);
        expect(ausenciaCubreElDia(m, '2026-10-15')).toBe(false);
        expect(ausenciaCubreElDia(m, '2026-10-30')).toBe(true);
    });

    it('vacaciones con rango, y sin fin sigue vigente', () => {
        expect(ausenciaCubreElDia({ startDate: '2026-10-01', endDate: '2026-10-10' }, '2026-10-05')).toBe(true);
        expect(ausenciaCubreElDia({ startDate: '2026-10-01', endDate: '2026-10-10' }, '2026-10-11')).toBe(false);
        expect(ausenciaCubreElDia(JSON.stringify({ startDate: '2026-10-01' }), '2026-12-01')).toBe(true);
        expect(ausenciaCubreElDia({}, '2026-10-01')).toBe(false);
    });

    it('ausenciasDelDia filtra con la misma regla', () => {
        const filas = [{ id: 1, metadata: { permissionDates: ['2026-10-01', '2026-10-30'] } }, { id: 2, metadata: { startDate: '2026-10-14' } }];
        expect(ausenciasDelDia(filas, '2026-10-15').map((f) => f.id)).toEqual([2]);
    });
});
