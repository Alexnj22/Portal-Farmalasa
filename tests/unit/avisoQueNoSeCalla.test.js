// El canal de avisos: reintentos, y qué pasa cuando aun así no sale.
//
// La regla que ordena todo este archivo:
//
//   > **Un aviso que no salió, y que nadie sabe que no salió, es peor que no
//   > tener aviso.**
//
// Las dos funciones hacían `catch (err) { console.error(err); return 0; }`, y
// eso dejó vivir **tres semanas** el 403 del push: el canal estaba roto y el
// portal no lo dijo ni una vez. Hoy reintenta lo transitorio y, si aun así no
// sale, **se le avisa a quien hizo la acción** — el único que puede levantar el
// teléfono y contarlo por otro medio.
//
// Y NO se reintenta un error que volvió CON respuesta del servidor: el RPC hace
// un INSERT, así que repetir algo que quizá sí se ejecutó **duplicaría la
// notificación**. «Failed to fetch» es el caso donde la petición con toda
// probabilidad no llegó a salir.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../src/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const showToast = vi.fn();
vi.mock('../../src/store/toastStore', () => ({
    useToastStore: { getState: () => ({ showToast }) },
}));

const { notifyEmployees, notifyBranch } = await import('../../src/utils/notify');
const { fireBrowserNotif } = await import('../../src/utils/browserNotif');

const ok = (n) => ({ data: n, error: null });
const fallo = (e) => ({ data: null, error: e });

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

/** Corre la promesa dejando pasar las esperas del reintento. */
async function correr(p) {
    const r = p;
    await vi.runAllTimersAsync();
    return r;
}

describe('cuando sale a la primera', () => {
    it('devuelve a cuántos alcanzó y no molesta a nadie', async () => {
        rpc.mockResolvedValue(ok(3));
        expect(await correr(notifyEmployees(['a', 'b', 'c'], { type: 'X', title: 'T' }))).toBe(3);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('los avisos a una sala y a personas son funciones DISTINTAS', async () => {
        // El primitivo quedó cerrado: el navegador entra por una puerta angosta
        // que exige un empleado, un tipo de la lista del portal y —la de
        // empleados— a lo sumo 10 destinatarios.
        rpc.mockResolvedValue(ok(1));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        const deEmpleados = rpc.mock.calls[0][0];
        rpc.mockClear();
        await correr(notifyBranch(4, { type: 'X', title: 'T' }));
        expect(rpc.mock.calls[0][0]).not.toBe(deEmpleados);
    });

    it('el push es opt-in: por defecto sólo enciende la campana', async () => {
        // La regla de ruido: push sólo para lo accionable. Un push por cada cosa
        // que pasa entrena a la gente a ignorarlos.
        rpc.mockResolvedValue(ok(1));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(Object.values(rpc.mock.calls[0][1])).toContain(false);
    });
});

describe('lo transitorio se reintenta', () => {
    it('un corte de red se reintenta hasta tres veces', async () => {
        rpc.mockResolvedValue(fallo({ message: 'Failed to fetch' }));
        expect(await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }))).toBe(0);
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it('un 5xx también', async () => {
        rpc.mockResolvedValue(fallo({ code: '503' }));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it('el timeout de la base también (57014)', async () => {
        rpc.mockResolvedValue(fallo({ code: '57014' }));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it('si el segundo intento sale, no hay tercero ni aviso de fallo', async () => {
        rpc.mockResolvedValueOnce(fallo({ message: 'Failed to fetch' })).mockResolvedValueOnce(ok(2));
        expect(await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }))).toBe(2);
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('una excepción de red cuenta igual que un error devuelto', async () => {
        rpc.mockRejectedValue(new Error('NetworkError when attempting to fetch resource'));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(rpc).toHaveBeenCalledTimes(3);
    });
});

describe('lo que NO se reintenta', () => {
    it('un permiso denegado se intenta UNA vez', async () => {
        // Da igual cuántas veces se mande.
        rpc.mockResolvedValue(fallo({ message: 'permission denied for function', code: '42501' }));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('un tipo no declarado (FORBIDDEN) tampoco se reintenta', async () => {
        // Un tipo nuevo hay que declararlo en la función, o el aviso rebota.
        rpc.mockResolvedValue(fallo({ message: 'FORBIDDEN' }));
        await correr(notifyEmployees(['a'], { type: 'INVENTADO', title: 'T' }));
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('un 4xx tampoco: el INSERT quizá se ejecutó y se duplicaría', async () => {
        rpc.mockResolvedValue(fallo({ code: '400' }));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(rpc).toHaveBeenCalledTimes(1);
    });
});

describe('cuando no sale, se entera QUIEN HIZO LA ACCIÓN', () => {
    it('se le muestra un aviso, no sólo un `console.error`', async () => {
        rpc.mockResolvedValue(fallo({ message: 'Failed to fetch' }));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'Pedido listo' }));
        expect(showToast).toHaveBeenCalledTimes(1);
        const [titulo, cuerpo, tono] = showToast.mock.calls[0];
        expect(titulo).toBe('No se pudo enviar el aviso');
        expect(tono).toBe('error');
        // Dice qué pasó, qué NO pasó, y qué hacer.
        expect(cuerpo).toContain('Tu acción sí se guardó');
        expect(cuerpo).toContain('Pedido listo');
        expect(cuerpo).toContain('Avísale por otro medio');
    });

    it('el texto es del portal, no de la base', async () => {
        // `humano: true` marca que la copia la escribimos nosotros: un mensaje
        // de Postgres crudo no le dice nada a quien está en el mostrador.
        rpc.mockResolvedValue(fallo({ message: 'Failed to fetch' }));
        await correr(notifyEmployees(['a'], { type: 'X', title: 'T' }));
        expect(showToast.mock.calls[0][4]).toMatchObject({ humano: true });
    });

    it('devuelve 0, y NUNCA lanza', async () => {
        // Que un aviso falle no puede deshacer la acción que ya se guardó.
        rpc.mockRejectedValue(new Error('Failed to fetch'));
        await expect(correr(notifyBranch(4, { type: 'X', title: 'T' }))).resolves.toBe(0);
    });

    it('sin título, el aviso sigue teniendo sentido', async () => {
        rpc.mockResolvedValue(fallo({ message: 'Failed to fetch' }));
        await correr(notifyBranch(4, { type: 'X', title: '' }));
        expect(showToast.mock.calls[0][1]).toContain('Avísale por otro medio');
    });
});

describe('la notificación del sistema operativo', () => {
    // Vivía copiada en `useSyncMonitor` y `useNotificationsChannel`, idéntica en
    // las dos. Es best-effort A PROPÓSITO: si el permiso está revocado, el
    // navegador no la soporta, o el constructor tira —pasa en Safari/iOS fuera
    // de un service worker—, no se hace nada. **Nunca debe romper el flujo que
    // la llamó.**
    const conPermiso = (permission, ctor) => {
        vi.stubGlobal('Notification', Object.assign(ctor ?? vi.fn(function N() {}), { permission }));
    };

    it('con permiso concedido, se muestra', () => {
        const N = vi.fn(function N() {});
        conPermiso('granted', N);
        fireBrowserNotif('Título', 'Cuerpo', 'tag-1');
        expect(N).toHaveBeenCalledWith('Título', expect.objectContaining({ body: 'Cuerpo', tag: 'tag-1' }));
    });

    it('la etiqueta es lo que evita apilar el mismo aviso muchas veces', () => {
        const N = vi.fn(function N() {});
        conPermiso('granted', N);
        fireBrowserNotif('T', 'B', 'pedido-114');
        expect(N.mock.calls[0][1].tag).toBe('pedido-114');
    });

    it('sin permiso NO se intenta', () => {
        const N = vi.fn(function N() {});
        conPermiso('denied', N);
        fireBrowserNotif('T', 'B', 'x');
        expect(N).not.toHaveBeenCalled();
    });

    it('«default» tampoco: pedir permiso no es cosa de un aviso suelto', () => {
        const N = vi.fn(function N() {});
        conPermiso('default', N);
        fireBrowserNotif('T', 'B', 'x');
        expect(N).not.toHaveBeenCalled();
    });

    it('si el navegador no la soporta, no revienta', () => {
        vi.stubGlobal('Notification', undefined);
        const antes = window.Notification;
        delete window.Notification;
        expect(() => fireBrowserNotif('T', 'B', 'x')).not.toThrow();
        window.Notification = antes;
    });

    it('si el constructor TIRA, tampoco: pasa en Safari fuera del service worker', () => {
        conPermiso('granted', vi.fn(function N() { throw new Error('not allowed'); }));
        expect(() => fireBrowserNotif('T', 'B', 'x')).not.toThrow();
    });
});
