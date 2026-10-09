import { describe, expect, it, vi } from 'vitest';
import { enRangoDeDias, esDeAntesDelPeriodo, filtrarPedidos, pedidosPorSala, rangoDeMes } from '@nucleo/utils/tableroDePedidos';
import { renglonesDeElectrolitFaltante } from '@nucleo/data/llegadaDePedido';
import { fetchAllRows } from '@nucleo/utils/supabaseUtils';

// Los filtros del tablero preguntan por la SALA, no por el pedido (2026-10-08).
describe('filtrarPedidos — el estado es el de la sala', () => {
    // Un pedido de dos salas: Salud 1 ya completó (recibido_erp_at), Salud 2
    // sigue en ruta. El PEDIDO está «enviado».
    const s1Lista   = { pedido_id: 'p', erp_sucursal_id: 1, pedido_status: 'enviado', enviado_at: 'x', recibido_erp_at: 'y', created_at: '2026-10-05T15:00:00Z' };
    const s2EnRuta  = { pedido_id: 'p', erp_sucursal_id: 2, pedido_status: 'enviado', enviado_at: 'x', created_at: '2026-10-05T15:00:00Z' };
    // Un pedido ya «completado» cuya sala tiene una caja faltante.
    const s3Falta   = { pedido_id: 'q', erp_sucursal_id: 3, pedido_status: 'completado', enviado_at: 'x', recibido_erp_at: 'y', llegada_tipo: 'falta_caja', falta_cajas: [2], created_at: '2026-10-05T15:00:00Z' };
    // Diferencia abierta en una sala de un pedido completado por las demás.
    const s4Dif     = { pedido_id: 'r', erp_sucursal_id: 4, pedido_status: 'completado', enviado_at: 'x', diferencias_reportadas_at: 'z', created_at: '2026-10-05T15:00:00Z' };
    const filas = [s1Lista, s2EnRuta, s3Falta, s4Dif];
    const ids = rs => rs.map(r => `${r.pedido_id}${r.erp_sucursal_id}`);

    it('«Completados» trae la sala que terminó aunque el pedido siga en ruta', () => {
        expect(ids(filtrarPedidos(filas, { estado: 'completado' }))).toEqual(['p1', 'q3']);
    });
    it('«Todos» esconde la sala terminada sin observación, no la que sigue en ruta', () => {
        expect(ids(filtrarPedidos(filas))).toEqual(['p2', 'q3', 'r4']);
    });
    it('«Con observación» no pierde la sala con diferencia de un pedido completado', () => {
        expect(ids(filtrarPedidos(filas, { estado: 'observacion' }))).toEqual(['q3', 'r4']);
    });
    it('«Con observación» no pierde la sala YA RECIBIDA con diferencias de un pedido abierto (paridad con producción)', () => {
        const s5Recibida = { pedido_id: 't', erp_sucursal_id: 5, pedido_status: 'enviado', enviado_at: 'x', recibido_erp_at: 'y', diferencias_reportadas_at: 'z', created_at: '2026-10-05T15:00:00Z' };
        expect(ids(filtrarPedidos([s5Recibida], { estado: 'observacion' }))).toEqual(['t5']);
    });
});

describe('el día del pedido es el de El Salvador', () => {
    // 2026-10-01 01:30 UTC = 30-sep 19:30 en la sala.
    const finDeMes = { erp_sucursal_id: 1, pedido_status: 'confirmado', created_at: '2026-10-01T01:30:00Z' };
    it('un pedido de la noche del 30 es de septiembre, no de octubre', () => {
        expect(enRangoDeDias(finDeMes.created_at, '2026-09-01|2026-09-30')).toBe(true);
        expect(enRangoDeDias(finDeMes.created_at, '2026-10-01|2026-10-31')).toBe(false);
        // Con un estado concreto, el período manda: no es de octubre.
        expect(filtrarPedidos([finDeMes], { estado: 'confirmado', rango: '2026-10-01|2026-10-31' })).toEqual([]);
        expect(pedidosPorSala([finDeMes], '2026-09-01|2026-09-30').get(1)).toBe(1);
    });
    it('una fecha sin hora se lee tal cual', () => {
        expect(enRangoDeDias('2026-10-01', '2026-10-01|2026-10-31')).toBe(true);
    });
    it('sin rango entra todo', () => {
        expect(enRangoDeDias(null, null)).toBe(true);
    });
    it('el mes de hoy es el de la sala aunque en UTC ya sea el siguiente', () => {
        // 1-nov 03:00 UTC = 31-oct 21:00 en El Salvador.
        expect(rangoDeMes(0, new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-01|2026-10-31');
        expect(rangoDeMes(-1, new Date('2026-01-15T18:00:00Z'))).toBe('2025-12-01|2025-12-31');
    });
});

describe('renglonesDeElectrolitFaltante — sólo se marca lo que se sabe cuál es', () => {
    const elec = (id, nombre, prod, unidades, extra = {}) => ({
        id, erp_product_id: prod, status: 'pendiente', dispatch_tipo: 'CAJA', dispatch_factor: 12,
        cantidad_asignada: unidades, products: { nombre }, ...extra,
    });
    const manzana = elec(1, 'ELECTROLIT MANZANA 625ML', 10, 24);  // 2 cajas
    const coco    = elec(2, 'ELECTROLIT COCO 625ML', 11, 12);     // 1 caja

    it('con dos sabores y una caja faltante NO marca ninguno: no se sabe cuál', () => {
        expect(renglonesDeElectrolitFaltante([manzana, coco], 1)).toEqual({ ids: [], sinUbicar: 1 });
    });
    it('si faltan todas las cajas, son todos los renglones', () => {
        expect(renglonesDeElectrolitFaltante([manzana, coco], 3)).toEqual({ ids: [1, 2], sinUbicar: 0 });
    });
    it('con un solo sabor, ése es', () => {
        const otraManzana = elec(3, 'ELECTROLIT MANZANA 625ML', 10, 12);
        expect(renglonesDeElectrolitFaltante([manzana, otraManzana], 1)).toEqual({ ids: [1, 3], sinUbicar: 0 });
    });
    it('cuenta CAJAS sobre lo que salió, no renglones ni lo asignado', () => {
        // Asignadas 2 cajas de manzana, salió 1: con una faltante y coco con 1,
        // faltan 2 de 2 → todos.
        const salioMenos = { ...manzana, cantidad_enviada: 12 };
        expect(renglonesDeElectrolitFaltante([salioMenos, coco], 2)).toEqual({ ids: [1, 2], sinUbicar: 0 });
    });
    it('deja afuera las cajas especiales, lo ya contado y lo que no va por caja', () => {
        const especial = elec(4, 'ELECTROLIT FRESA 625ML', 12, 12, { caja_especial: true });
        const contado  = elec(5, 'ELECTROLIT UVA 625ML', 13, 12, { status: 'recibido' });
        const suelto   = elec(6, 'ELECTROLIT LIMA 625ML', 14, 12, { dispatch_tipo: 'unidad' });
        expect(renglonesDeElectrolitFaltante([especial, contado, suelto, coco], 1)).toEqual({ ids: [2], sinUbicar: 0 });
    });
    it('sin candidatos, el faltante queda sin renglón', () => {
        expect(renglonesDeElectrolitFaltante([], 2)).toEqual({ ids: [], sinUbicar: 2 });
        expect(renglonesDeElectrolitFaltante([manzana], 0)).toEqual({ ids: [], sinUbicar: 0 });
    });
});

describe('fetchAllRows — una lista a medias no se hace pasar por entera', () => {
    const paginas = (fallaEn) => {
        let n = 0;
        return () => ({
            range: async () => {
                const pagina = n++;
                if (pagina === fallaEn) return { data: null, error: { message: 'corte' } };
                return { data: pagina < 1 ? Array.from({ length: 1000 }, (_, i) => i) : [1], error: null };
            },
        });
    };
    it('por omisión devuelve lo que juntó (comportamiento de siempre)', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect((await fetchAllRows(paginas(1))).length).toBe(1000);
        err.mockRestore();
    });
    it('con `completo` devuelve null si falla cualquier página', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await fetchAllRows(paginas(1), { completo: true })).toBeNull();
        expect((await fetchAllRows(paginas(-1), { completo: true })).length).toBe(1001);
        err.mockRestore();
    });
});

// «Pendientes y con observación» no pierde lo que sigue abierto de un mes
// anterior (2026-10-09): con «Este mes» y todo lo del mes ya recibido, la lista
// salía vacía mientras dos pedidos de agosto seguían con algo pendiente.
describe('pendientes de meses anteriores', () => {
    const octubre = '2026-10-01|2026-10-31';
    const agostoAbierto   = { pedido_id: 'a', erp_sucursal_id: 1, pedido_status: 'parcial', enviado_at: 'x', diferencias_reportadas_at: 'z', created_at: '2026-08-17T15:00:00Z' };
    const agostoCompleto  = { pedido_id: 'b', erp_sucursal_id: 2, pedido_status: 'completado', enviado_at: 'x', recibido_erp_at: 'y', created_at: '2026-08-10T15:00:00Z' };
    const octubreCompleto = { pedido_id: 'c', erp_sucursal_id: 3, pedido_status: 'completado', enviado_at: 'x', recibido_erp_at: 'y', created_at: '2026-10-03T15:00:00Z' };
    const filas = [agostoAbierto, agostoCompleto, octubreCompleto];
    const ids = rs => rs.map(r => r.pedido_id);
    it('se ven con el filtro por defecto, y lo completado de antes no', () => {
        expect(ids(filtrarPedidos(filas, { rango: octubre }))).toEqual(['a']);
        expect(esDeAntesDelPeriodo(agostoAbierto, octubre)).toBe(true);
        expect(esDeAntesDelPeriodo(octubreCompleto, octubre)).toBe(false);
    });
    it('«Completados» sigue mirando sólo el período', () => {
        expect(ids(filtrarPedidos(filas, { estado: 'completado', rango: octubre }))).toEqual(['c']);
    });
});
