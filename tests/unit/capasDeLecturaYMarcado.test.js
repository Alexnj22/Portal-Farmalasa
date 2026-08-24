// Seis capas de datos que LEEN y MARCAN, y las reglas que sólo viven en la
// forma de la consulta.
//
// Ninguna calcula nada, así que no hay resultado que salga mal: lo que sale mal
// es qué filas llegan y qué filas se pisan. Tres cosas concretas que se anclan
// acá porque nada más las mira:
//
//   · **marcar leído no puede pisar una lectura anterior.** El `.is('read_at',
//     null)` es lo que hace que «marcar todo» no reescriba el instante en que
//     alguien ya la había visto;
//   · **un maestro que agrupa miles de filas va por RPC de JSON**, no por
//     SETOF: «CAJA» agrupa 2.222 productos y el detalle cruzaría el tope de las
//     1000 en silencio;
//   · **la salud de las sincronizaciones mira sólo los dominios sin vigilancia
//     propia.** Duplicar la vigilancia no la mejora: reparte la atención.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchNotifications, markNotificationRead, markNotificationsReadBulk,
        deleteNotificationsByIds, deleteNotificationsBefore } =
    await import('../../src/data/notifications');
const { fetchPresentacionesMaestro, fetchProductosPorPresentacion } =
    await import('../../src/data/presentaciones');
const { fetchSyncHealthRecent, SYNC_HEALTH_DOMAINS } = await import('../../src/data/syncHealth');
const { fetchOrphanObjects, updateOrphanObjectStatus } = await import('../../src/data/orphanObjects');
const { fetchVentasPerdidas, fetchVentasPerdidasPendingCount, updateVentaPerdidaStatus } =
    await import('../../src/data/ventasPerdidas');
const { fetchPayrollEntriesByPeriod, deletePendingPayrollEntries } =
    await import('../../src/data/payroll');

beforeEach(() => espia.limpiar());

describe('la campana', () => {
    it('trae quién originó el aviso, no sólo el texto', () => {
        // `created_by` estaba en la tabla y no se leía, así que la campana no
        // podía poner la cara de quien pide: había que abrir la solicitud para
        // saber de quién era.
        fetchNotifications();
        expect(espia.primero('select')[0]).toContain('created_by');
    });

    it('marcar leído NO pisa una lectura anterior', () => {
        // Sin el `.is('read_at', null)`, «marcar todas» reescribiría el instante
        // en que alguien ya la había visto y se perdería cuándo fue.
        markNotificationRead(5, '2026-08-24T12:00:00Z');
        expect(espia.primero('is')).toEqual(['read_at', null]);
        expect(espia.primero('update')[0]).toEqual({ read_at: '2026-08-24T12:00:00Z' });
    });

    it('marcar varias tiene la MISMA guarda que marcar una', () => {
        markNotificationsReadBulk([1, 2, 3], '2026-08-24T12:00:00Z');
        expect(espia.primero('is')).toEqual(['read_at', null]);
        expect(espia.primero('in')).toEqual(['id', [1, 2, 3]]);
    });

    it('borrar por antigüedad usa un corte, no un borrado sin filtro', () => {
        deleteNotificationsBefore('2026-05-01T00:00:00Z');
        expect(espia.uso('delete')).toBe(true);
        expect(espia.primero('lte')).toEqual(['created_at', '2026-05-01T00:00:00Z']);
    });

    it('borrar seleccionadas siempre lleva la lista de ids', () => {
        deleteNotificationsByIds([9]);
        expect(espia.primero('in')).toEqual(['id', [9]]);
    });
});

describe('el maestro de presentaciones va por JSON, no por filas', () => {
    it('el maestro es un RPC', async () => {
        await fetchPresentacionesMaestro();
        expect(espia.rpc[0].nombre).toBe('get_presentaciones_maestro');
        expect(espia.uso('from')).toBe(false);
    });

    it('el detalle también, y lleva el tipo como argumento', async () => {
        // «CAJA» agrupa 2.222 productos: devolver filas lo truncaría en silencio.
        await fetchProductosPorPresentacion('CAJA');
        expect(espia.rpc[0]).toEqual({ nombre: 'get_productos_por_presentacion',
                                       args: { p_tipo: 'CAJA' } });
    });

    it('sin respuesta devuelve un arreglo vacío, nunca null', async () => {
        // La pantalla hace `.map` sobre esto.
        const { data } = await fetchPresentacionesMaestro();
        expect(Array.isArray(data)).toBe(true);
    });
});

describe('la salud de las sincronizaciones', () => {
    it('mira los cuatro dominios SIN vigilancia propia', () => {
        // `dte` tiene `check-sales-alerts` e `inventory` tiene el banner y
        // `useSyncMonitor`: repetirlos acá reparte la atención en vez de sumarla.
        expect(SYNC_HEALTH_DOMAINS).toEqual(['products', 'minmax', 'purchases', 'backup']);
        expect(SYNC_HEALTH_DOMAINS).not.toContain('dte');
        expect(SYNC_HEALTH_DOMAINS).not.toContain('inventory');
    });

    it('filtra por esos dominios y trae lo más reciente primero', () => {
        fetchSyncHealthRecent();
        expect(espia.tabla()).toBe('v_sync_health');
        expect(espia.primero('in')).toEqual(['domain', SYNC_HEALTH_DOMAINS]);
        expect(espia.primero('order')).toEqual(['checked_at', { ascending: false }]);
    });

    it('el tope por defecto está lejos del cap de PostgREST', () => {
        // Un tope que coincide con el cap no se distingue de un truncamiento.
        fetchSyncHealthRecent();
        expect(espia.primero('limit')).toEqual([200]);
    });

    it('trae el mensaje de error: un fallo sin motivo no se puede diagnosticar', () => {
        fetchSyncHealthRecent();
        expect(espia.primero('select')[0]).toContain('error_msg');
    });
});

describe('los objetos huérfanos: la pantalla lee y marca, no crea ni borra', () => {
    it('resolver estampa el instante; volver atrás lo borra', () => {
        // Un `resolved_at` que sobrevive a la reapertura diría que se resolvió
        // algo que está abierto.
        updateOrphanObjectStatus(3, 'resolved');
        expect(espia.primero('update')[0].resolved_at).not.toBeNull();
        espia.limpiar();
        updateOrphanObjectStatus(3, 'open');
        expect(espia.primero('update')[0].resolved_at).toBeNull();
    });

    it('la lista no ofrece insertar ni borrar', () => {
        // Un caso nuevo entra por migración, cuando se confirmó. Si la pantalla
        // pudiera agregar, el registro se llenaría de sospechas y dejaría de
        // significar «confirmado como muerto».
        fetchOrphanObjects();
        expect(espia.uso('insert')).toBe(false);
        expect(espia.uso('delete')).toBe(false);
    });
});

describe('las ventas perdidas', () => {
    it('se piden por estado y con las más nuevas arriba', () => {
        fetchVentasPerdidas('pendiente');
        expect(espia.tabla()).toBe('ventas_perdidas');
        expect(espia.primero('eq')).toEqual(['status', 'pendiente']);
        expect(espia.primero('order')).toEqual(['created_at', { ascending: false }]);
    });

    it('el contador del menú pide SÓLO el número, no las filas', () => {
        // Es un badge: bajar los registros para contarlos los traería con el
        // tope de 1000 encima y el número quedaría corto.
        fetchVentasPerdidasPendingCount();
        expect(espia.primero('select')[1]).toEqual({ count: 'exact', head: true });
    });

    it('cambiar el estado toca una fila identificada', () => {
        updateVentaPerdidaStatus(12, 'resuelto');
        expect(espia.primero('eq')).toEqual(['id', 12]);
    });
});

describe('la planilla', () => {
    it('regenerar borra SÓLO lo pendiente', () => {
        // Lo ya confirmado no se pisa: si se pudiera, regenerar sería una forma
        // silenciosa de deshacer una decisión.
        deletePendingPayrollEntries(4);
        expect(espia.uso('delete')).toBe(true);
        const filtros = espia.todos('eq');
        expect(filtros).toContainEqual(['period_id', 4]);
        expect(filtros).toContainEqual(['status', 'PENDING']);
    });

    it('las entradas de un período salen en el orden en que se crearon', () => {
        fetchPayrollEntriesByPeriod(4);
        expect(espia.tabla()).toBe('payroll_entries');
        expect(espia.primero('order')).toEqual(['created_at', { ascending: true }]);
    });
});
