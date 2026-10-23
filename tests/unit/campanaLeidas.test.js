import { describe, it, expect, vi, beforeEach } from 'vitest';

/* Qué se queda y qué se va de la CAMPANA.
 *
 * Son tres reglas que se contradicen si se leen sueltas, y por eso hay que
 * anclarlas juntas:
 *
 *   1. Leer una la SACA de la campana (2026-09-04: «al leer las notificaciones
 *      en la campana, que se quiten de ahí»).
 *   2. Pero decidir una solicitud desde ahí la DEJA, con su sello «Aprobada /
 *      Rechazada» — «ese sí me gustaba, que saliera ahí si fue aceptado o
 *      rechazado». Es la excepción, y tiene motivo: el sello es la respuesta a
 *      algo que la persona acaba de hacer.
 *   3. Y quitarla de la campana la saca, pero NO la borra: sigue en el listado.
 *
 * La segunda ya se rompió una vez, en el mismo día que nació la primera: los
 * caminos que deciden marcan leído al ARRANCAR la acción, y con el borrado por
 * defecto la tarjeta se iba antes de que el sello llegara. No daba ningún error
 * — la tarjeta simplemente desaparecía, que es indistinguible de «funcionó».
 */

vi.mock('@nucleo/supabaseClient', () => ({ supabase: {} }));
vi.mock('@nucleo/data/notifications', () => ({
    fetchNotifications: vi.fn(),
    markNotificationRead: vi.fn(async () => ({ error: null })),
    markNotificationsReadBulk: vi.fn(async () => ({ error: null })),
    markNotificationsReadBefore: vi.fn(async () => ({ error: null })),
    deleteNotificationsByIds: vi.fn(async () => ({ error: null })),
    deleteNotificationsBefore: vi.fn(async () => ({ error: null })),
    restoreNotificationsByIds: vi.fn(async () => ({ error: null })),
}));

const { createNotificationsSlice } = await import('@nucleo/store/slices/notificationsSlice');
const datos = await import('@nucleo/data/notifications');

const REQ = '11111111-1111-1111-1111-111111111111';

/** Un store mínimo: `set` que funde el parche, y `get` que devuelve el estado. */
const crearStore = (notifications) => {
    let estado = {};
    const set = (parche) => {
        const nuevo = typeof parche === 'function' ? parche(estado) : parche;
        estado = { ...estado, ...nuevo };
    };
    const get = () => estado;
    estado = { ...createNotificationsSlice(set, get), notifications };
    return { get: () => estado, acciones: () => estado };
};

const avisos = () => ([
    { id: 'a', type: 'REQUEST_PENDING', read_at: null, deleted_at: null, metadata: { request_id: REQ } },
    { id: 'b', type: 'CORTE_NUEVO',     read_at: null, deleted_at: null, metadata: {} },
    { id: 'c', type: 'PEDIDO_LLEGADA',  read_at: null, deleted_at: null, metadata: {} },
]);

describe('la campana: qué se queda y qué se va', () => {
    let store;
    beforeEach(() => { store = crearStore(avisos()); });

    it('leer una la saca de la campana', async () => {
        await store.acciones().markNotificationRead('b');
        expect(store.get().notifications.map(n => n.id)).toEqual(['a', 'c']);
    });

    it('marcar todas como leídas la vacía', async () => {
        await store.acciones().markAllNotificationsRead();
        expect(store.get().notifications).toHaveLength(0);
    });

    // H14 (2026-10-23): la campana carga 100 no leídas; marcar sólo esas
    // dejaba aparecer otras 100. Se marca en el servidor hasta el clic, sin
    // tocar los tipos que pueden esperar una decisión.
    it('«leer todas» marca en el servidor, no sólo lo cargado, y respeta lo que espera decisión', async () => {
        datos.markNotificationsReadBefore.mockClear();
        datos.markNotificationsReadBulk.mockClear();
        await store.acciones().markAllNotificationsRead({ conservar: (n) => n.id === 'a' });
        expect(datos.markNotificationsReadBefore).toHaveBeenCalledTimes(1);
        const [, , tipos] = datos.markNotificationsReadBefore.mock.calls[0];
        expect(tipos).toEqual(expect.arrayContaining(['REQUEST_PENDING', 'MINMAX_PENDING', 'MAYORISTA_SOLICITUD']));
        expect(datos.markNotificationsReadBulk, 'nada de decisión que marcar a mano').not.toHaveBeenCalled();
        expect(store.get().notifications.map(n => n.id), 'la que espera decisión se queda').toEqual(['a']);
    });

    it('si el servidor no marca, la campana se vuelve a leer en vez de quedar vacía', async () => {
        datos.markNotificationsReadBefore.mockResolvedValueOnce({ error: new Error('red') });
        const recargar = vi.fn();
        store.get().fetchNotifications = recargar;
        const errorConsola = vi.spyOn(console, 'error').mockImplementation(() => {});
        await store.acciones().markAllNotificationsRead();
        expect(recargar).toHaveBeenCalled();
        errorConsola.mockRestore();
    });

    it('`quitar: false` la deja, para que el sello de la decisión alcance a verse', async () => {
        await store.acciones().markNotificationRead('a', { quitar: false });
        const fila = store.get().notifications.find(n => n.id === 'a');
        expect(fila, 'la tarjeta que se está decidiendo NO se va').toBeTruthy();
        expect(fila.read_at, 'pero queda marcada como leída').toBeTruthy();
    });

    it('decidir deja la tarjeta con su estado', () => {
        store.acciones().marcarAvisoDeSolicitudResuelto(REQ, 'APPROVED');
        const fila = store.get().notifications.find(n => n.id === 'a');
        expect(fila, 'la tarjeta se queda a la vista').toBeTruthy();
        expect(fila.metadata.resuelta, 'con el estado que la tarjeta pinta').toBe('APPROVED');
        expect(fila.read_at, 'y ya leída, así que no vuelve en la próxima carga').toBeTruthy();
    });

    it('rechazar deja el estado que corresponde, no un booleano', () => {
        store.acciones().marcarAvisoDeSolicitudResuelto(REQ, 'REJECTED');
        expect(store.get().notifications.find(n => n.id === 'a').metadata.resuelta).toBe('REJECTED');
    });

    it('un UPDATE con `read_at` NO saca la fila: por ahí llega el sello', () => {
        // El trigger de la base escribe `metadata.resuelta` sobre una fila que
        // ya está leída. Si `read_at` sacara la fila, ese UPDATE borraría justo
        // el «Aprobada» que se quiere ver.
        store.acciones()._replaceNotification({
            id: 'a', read_at: '2026-09-04T10:00:00Z', metadata: { request_id: REQ, resuelta: 'APPROVED' },
        });
        const fila = store.get().notifications.find(n => n.id === 'a');
        expect(fila).toBeTruthy();
        expect(fila.metadata.resuelta).toBe('APPROVED');
    });

    it('un UPDATE con `deleted_at` SÍ la saca: se quitó de la campana', () => {
        store.acciones()._replaceNotification({ id: 'b', deleted_at: '2026-09-04T10:00:00Z' });
        expect(store.get().notifications.map(n => n.id)).toEqual(['a', 'c']);
    });
});
