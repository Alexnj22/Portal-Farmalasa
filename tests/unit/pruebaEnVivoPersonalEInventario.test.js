// Defectos de la prueba en vivo del 2026-10-22 que viven en la capa de datos:
//
//   · el tope de un descargo se contaba sobre la fila que dejaba el buscador
//     (una por producto): TEGADERM con 7 sueltas y una caja de 8 decía «7»;
//   · registrar una sanción y decidir su descuento no dejaban rastro en la
//     bitácora;
//   · la planilla leía las incapacidades con el permiso de SOLICITUDES y por
//     fecha de presentación, no por los días de la incapacidad.

import { describe, it, expect, beforeEach, vi } from 'vitest';

let respuesta = { data: [], error: null };
const pasos = [];
const rpc = [];
const respuestasRpc = {};
const nodo = {
    then: (resolver) => Promise.resolve(respuesta).then(resolver),
};
for (const m of ['select', 'eq', 'gt', 'gte', 'lte', 'in', 'or', 'order', 'range']) {
    nodo[m] = (...args) => { pasos.push({ metodo: m, args }); return nodo; };
}
const supabase = {
    from: (tabla) => { pasos.push({ metodo: 'from', args: [tabla] }); return nodo; },
    rpc: (nombre, args) => {
        rpc.push({ nombre, args });
        const r = respuestasRpc[nombre] ?? { data: null, error: null };
        return Promise.resolve(r);
    },
};
vi.mock('@nucleo/supabaseClient', () => ({ supabase }));

const { fetchLotesDeProducto } = await import('@nucleo/data/inventoryMovements');
const { registrarSancion, decidirDescuentoDeSuspension } = await import('@nucleo/data/disciplina');
const { fetchSolicitudesDeIncapacidad } = await import('@nucleo/data/payroll');

beforeEach(() => {
    pasos.length = 0; rpc.length = 0;
    for (const k of Object.keys(respuestasRpc)) delete respuestasRpc[k];
    respuesta = { data: [], error: null };
});

const esperar = () => new Promise(r => setTimeout(r, 0));

describe('descargo: las unidades de la sala son TODAS las filas del producto', () => {
    it('TEGADERM: 7 sueltas + 1 caja de 8 son 15, no 7', async () => {
        respuesta = { data: [
            { erp_product_id: 501, lote: 'GENERICO', fecha_vencimiento: null, presentacion: 'UNIDAD', detalle: '1x1', cantidad: 7 },
            { erp_product_id: 501, lote: 'GENERICO', fecha_vencimiento: null, presentacion: 'CAJA',   detalle: '1x8', cantidad: 1 },
        ], error: null };
        const r = await fetchLotesDeProducto({ erpProductId: 501, erpSucursalId: 3 });
        expect(r.unidades).toBe(15);
        expect(r.lotes).toEqual([]);   // GENERICO no es un lote para elegir
        // La consulta va por producto Y sala, y trae el detalle para el factor.
        expect(pasos.find(p => p.metodo === 'select').args[0]).toMatch(/detalle/);
        expect(pasos.filter(p => p.metodo === 'eq').map(p => p.args[0])).toEqual(
            expect.arrayContaining(['erp_product_id', 'erp_sucursal_id']));
    });

    it('lotes en varias presentaciones también se suman en unidades', async () => {
        respuesta = { data: [
            { erp_product_id: 9, lote: 'L1', fecha_vencimiento: '2027-01-01', presentacion: 'CAJA',    detalle: '1x30', cantidad: 2 },
            { erp_product_id: 9, lote: 'L1', fecha_vencimiento: '2027-01-01', presentacion: 'BLISTER', detalle: '1x10', cantidad: 1 },
            { erp_product_id: 9, lote: 'L2', fecha_vencimiento: '2027-06-01', presentacion: 'UNIDAD',  detalle: '1x1',  cantidad: 4 },
        ], error: null };
        const r = await fetchLotesDeProducto({ erpProductId: '9', erpSucursalId: 3 });
        expect(r.unidades).toBe(74);
        expect(r.lotes).toHaveLength(2);
    });

    it('si la lectura pudo quedar cortada, no inventa un tope', async () => {
        respuesta = { data: Array.from({ length: 201 }, () => ({ erp_product_id: 1, lote: 'L', presentacion: 'UNIDAD', detalle: '1x1', cantidad: 1 })), error: null };
        expect((await fetchLotesDeProducto({ erpProductId: 1, erpSucursalId: 3 })).unidades).toBeNull();
    });
});

describe('sanciones: dejan fila en la bitácora', () => {
    it('registrar la sanción anota SANCION_REGISTRADA con su evento', async () => {
        respuestasRpc.registrar_sancion = { data: 'ev-123', error: null };
        const id = await registrarSancion({ employeeId: 'e1', falta: 'TARDANZA', peldano: 3, fecha: '2026-10-22', dias: 1, conDescuento: true });
        await esperar();
        expect(id).toBe('ev-123');
        const bitacora = rpc.find(r => r.nombre === 'registrar_bitacora');
        expect(bitacora?.args.p_action).toBe('SANCION_REGISTRADA');
        expect(bitacora.args.p_target_id).toBe('e1');
        expect(bitacora.args.p_details).toMatchObject({ evento_id: 'ev-123', peldano: 3, con_descuento: true });
    });

    it('si la base la rechaza, no se anota nada', async () => {
        respuestasRpc.registrar_sancion = { data: null, error: { message: 'ART83_3' } };
        await expect(registrarSancion({ employeeId: 'e1', falta: 'X', peldano: 3, fecha: '2026-10-22', dias: 2 })).rejects.toBeTruthy();
        await esperar();
        expect(rpc.some(r => r.nombre === 'registrar_bitacora')).toBe(false);
    });

    it('decidir el descuento anota la decisión', async () => {
        await decidirDescuentoDeSuspension('ev-9', false);
        await esperar();
        const bitacora = rpc.find(r => r.nombre === 'registrar_bitacora');
        expect(bitacora?.args.p_action).toBe('SUSPENSION_DESCUENTO_DECIDIDO');
        expect(bitacora.args.p_details).toMatchObject({ con_descuento: false });
    });
});

describe('planilla: las incapacidades salen de la función, por rango de días', () => {
    it('no lee approval_requests con el permiso de solicitudes', async () => {
        const filas = [{ id: 'r1', employee_id: 'e1', type: 'DISABILITY', status: 'PENDING', metadata: { startDate: '2026-10-10', endDate: '2026-10-14' } }];
        respuestasRpc.planilla_incapacidades_de_quincena = { data: filas, error: null };
        const r = await fetchSolicitudesDeIncapacidad('2026-10-01', '2026-10-15');
        expect(r).toEqual({ data: filas, error: null });
        expect(rpc[0]).toEqual({ nombre: 'planilla_incapacidades_de_quincena', args: { p_desde: '2026-10-01', p_hasta: '2026-10-15' } });
        expect(pasos.some(p => p.metodo === 'from')).toBe(false);
    });

    it('un rechazo de permiso se devuelve como error, sin leer la tabla', async () => {
        respuestasRpc.planilla_incapacidades_de_quincena = { data: null, error: { message: 'FORBIDDEN', code: '42501' } };
        const r = await fetchSolicitudesDeIncapacidad('2026-10-01', '2026-10-15');
        expect(r.error?.message).toBe('FORBIDDEN');
        expect(pasos.some(p => p.metodo === 'from')).toBe(false);
    });
});
