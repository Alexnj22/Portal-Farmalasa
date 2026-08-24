// La bitácora de acciones: quién firma, con qué gravedad y desde dónde.
//
// Toda acción de usuario pasa por acá (`appendAuditLog`), así que es la única
// forma de reconstruir qué pasó cuando alguien pregunta. Dos reglas suyas no se
// ven desde ningún otro lado:
//
//   · **la autoría sale de la SESIÓN**, no de `sb_user` en `localStorage` — ese
//     lo escribe el navegador y se puede editar. Desde la migración
//     `20260806000957` la policy de INSERT exige `user_id = auth.uid()`, así
//     que mandar otra cosa no es sólo incorrecto: **la fila se rechaza** y
//     `appendAuditLog` se traga el error. Bitácora muda;
//   · **la gravedad y el origen se DEDUCEN** de la acción, y los dos están
//     acotados por un constraint de Postgres: un valor fuera del catálogo
//     rechazaría la fila entera.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const insertAuditLog = vi.fn(async (fila) => ({ data: { id: 1, ...fila }, error: null }));
const getSessionUserId = vi.fn(async () => 'uid-de-la-sesion');
const fetchAuditLogsData = vi.fn(async () => ({ data: [], error: null }));

vi.mock('../../src/data/audit', () => ({
    insertAuditLog: (...a) => insertAuditLog(...a),
    getSessionUserId: (...a) => getSessionUserId(...a),
    fetchAuditLogs: (...a) => fetchAuditLogsData(...a),
}));

const { createAuditSlice } = await import('../../src/store/slices/auditSlice');

/** Un slice con un `set` que no hace nada más que registrar. */
function armar() {
    const estados = [];
    const set = (fn) => estados.push(typeof fn === 'function' ? fn({ auditLog: [] }) : fn);
    return { slice: createAuditSlice(set), estados };
}

/** La fila que se habría escrito. */
async function anotar(...args) {
    const { slice } = armar();
    await slice.appendAuditLog(...args);
    return insertAuditLog.mock.calls.at(-1)?.[0] ?? null;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getSessionUserId.mockResolvedValue('uid-de-la-sesion');
});

describe('quién firma', () => {
    it('el `user_id` sale de la sesión, no de `localStorage`', async () => {
        localStorage.setItem('sb_user', JSON.stringify({ id: 'uid-INVENTADO', name: 'Ana' }));
        const fila = await anotar('EDITAR_EMPLEADO', '7');
        expect(fila.user_id).toBe('uid-de-la-sesion');
    });

    it('sin sesión hidratada cae al de `localStorage`, y si no, a null', async () => {
        // Es un respaldo declarado: la policy va a rechazar igual, pero la fila
        // no se arma con `undefined`.
        getSessionUserId.mockResolvedValue(null);
        localStorage.setItem('sb_user', JSON.stringify({ id: 'uid-guardado', name: 'Ana' }));
        expect((await anotar('X')).user_id).toBe('uid-guardado');

        localStorage.clear();
        expect((await anotar('X')).user_id).toBeNull();
    });

    it('el NOMBRE sí puede venir de afuera: el kiosco firma por quien marcó', async () => {
        const fila = await anotar({ action: 'MARCACION', userName: 'Merlyn Sol' });
        expect(fila.user_name).toBe('Merlyn Sol');
    });

    it('sin nombre por ningún lado dice «Sistema/Anónimo», no queda vacío', async () => {
        expect((await anotar('X')).user_name).toBe('Sistema/Anónimo');
    });
});

describe('qué se anota', () => {
    it('una acción vacía NO escribe fila', async () => {
        // Una fila sin acción no dice nada y ensucia la bitácora.
        for (const a of ['', '   ', null, undefined]) {
            await anotar(a);
            expect(insertAuditLog).not.toHaveBeenCalled();
        }
    });

    it('la acción se recorta', async () => {
        expect((await anotar('  EDITAR_EMPLEADO  ')).action).toBe('EDITAR_EMPLEADO');
    });

    it('el `target_id` vacío es null, no la cadena vacía', async () => {
        // Un `''` se guardaría como un objetivo que no existe.
        expect((await anotar('X', '')).target_id).toBeNull();
        expect((await anotar('X', '   ')).target_id).toBeNull();
        expect((await anotar('X', 7)).target_id).toBe('7');
    });

    it('acepta la forma de objeto además de la posicional', async () => {
        const fila = await anotar({ action: 'X', targetId: 9, details: { a: 1 } });
        expect(fila.action).toBe('X');
        expect(fila.target_id).toBe('9');
        expect(fila.details).toMatchObject({ a: 1 });
    });
});

describe('la gravedad se deduce, y está acotada', () => {
    it('lo que destruye o se deniega es CRITICAL', async () => {
        for (const a of ['ELIMINAR_EMPLEADO', 'REVOCAR_PERMISO', 'VINCULAR_KIOSCO',
                         'INTENTO_DE_ACCESO', 'ACCESO_DENEGADO', 'SOSPECHA_DE_FRAUDE'])
            expect((await anotar(a)).severity).toBe('CRITICAL');
    });

    it('un fallo es WARNING', async () => {
        for (const a of ['FALLO_DE_SYNC', 'ERROR_AL_IMPRIMIR'])
            expect((await anotar(a)).severity).toBe('WARNING');
    });

    it('lo demás es INFO', async () => {
        expect((await anotar('EDITAR_EMPLEADO')).severity).toBe('INFO');
    });

    it('una gravedad escrita a mano gana, si es del catálogo', async () => {
        expect((await anotar({ action: 'X', severity: 'critical' })).severity).toBe('CRITICAL');
    });

    it('una que NO es del catálogo cae a INFO en vez de rechazar la fila', async () => {
        // El constraint de Postgres sólo acepta INFO, WARNING y CRITICAL: un
        // valor inventado tiraría el insert entero y se perdería la anotación.
        expect((await anotar({ action: 'X', severity: 'URGENTISIMO' })).severity).toBe('INFO');
    });
});

describe('de dónde vino', () => {
    it('con datos del kiosco, el origen es el kiosco', async () => {
        expect((await anotar('MARCACION', null, { audit_info: { x: 1 } })).source).toBe('KIOSK');
    });

    it('un origen escrito a mano gana, si es del catálogo', async () => {
        expect((await anotar({ action: 'X', source: 'system' })).source).toBe('SYSTEM');
    });

    it('uno inventado cae al panel en vez de rechazar la fila', async () => {
        expect((await anotar({ action: 'X', source: 'TELEGRAMA' })).source).toBe('ADMIN_PANEL');
    });

    it('sin nada, es el panel', async () => {
        expect((await anotar('X')).source).toBe('ADMIN_PANEL');
    });
});

describe('cuando la escritura falla', () => {
    it('no revienta la acción que la llamó', async () => {
        // La bitácora es una consecuencia de la acción, no su condición: que
        // falle no puede deshacer lo que el usuario acaba de hacer.
        insertAuditLog.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
        const { slice } = armar();
        await expect(slice.appendAuditLog('X')).resolves.toBeNull();
    });
});
