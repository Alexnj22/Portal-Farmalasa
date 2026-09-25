// El aviso del sistema es del EQUIPO; su dueño es quien tenga sesión ahí.
//
// Web Push no tiene forma de pertenecer a una cuenta: el `endpoint` lo emite el
// navegador de esa computadora y es la única dirección que existe. En las
// máquinas de mostrador, donde el turno cambia de persona y el equipo no, eso
// dejaba la suscripción ligada al PRIMERO que apretó «Activar» — los avisos de
// quien ya se fue seguían cayendo en esa pantalla y el siguiente no recibía
// ninguno de los suyos.
//
// Se prueba porque la decisión central es un `if` de una línea con dos
// consecuencias opuestas y ninguna visible:
//
//   · `app` (el teléfono de alguien) → **nunca** se suelta. Recibir avisos con
//     la app cerrada es lo único para lo que existe, y la sesión se cierra sola
//     por inactividad;
//   · `navegador` (compartido) → se suelta. Una computadora sin nadie adentro
//     no le manda avisos a nadie.
//
// Invertirlo no rompe nada visible: simplemente los avisos dejan de llegar al
// teléfono, o siguen llegando al mostrador de quien ya se fue.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const reclamarPushSubscription = vi.fn();
const soltarPushSubscription   = vi.fn();
vi.mock('../../src/data/pushSubscriptions', () => ({
    reclamarPushSubscription: (...a) => reclamarPushSubscription(...a),
    soltarPushSubscription:   (...a) => soltarPushSubscription(...a),
}));

const SUB = {
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'llave', auth: 'auth' } }),
};

const montarNavegador = (sub) => {
    globalThis.navigator = { serviceWorker: { getRegistration: async () => (sub ? { pushManager: { getSubscription: async () => sub } } : null) } };
    globalThis.window = { PushManager: function () {} };
};

let mod;
beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    reclamarPushSubscription.mockResolvedValue({ error: null });
    soltarPushSubscription.mockResolvedValue({ error: null });
    montarNavegador(SUB);
    mod = await import('../../src/plataforma/pushEquipo');
});
afterEach(() => { delete globalThis.navigator; delete globalThis.window; });

describe('reclamar el equipo al entrar', () => {
    it('liga la suscripción de este navegador al empleado', async () => {
        await expect(mod.reclamarPushDelEquipo('emp-1')).resolves.toBe(true);
        expect(reclamarPushSubscription).toHaveBeenCalledWith({
            endpoint: 'https://push.example/abc', p256dh: 'llave', auth: 'auth',
        });
    });

    it('sale UNA sola llamada aunque el hook esté montado dos veces', async () => {
        // El banner y la barra lateral preguntan por el mismo equipo. Sin la
        // promesa compartida saldrían dos escrituras a la misma fila.
        const [a, b] = await Promise.all([
            mod.reclamarPushDelEquipo('emp-1'),
            mod.reclamarPushDelEquipo('emp-1'),
        ]);
        expect(a).toBe(b);
        expect(reclamarPushSubscription).toHaveBeenCalledTimes(1);
    });

    it('otro empleado sí vuelve a reclamar', async () => {
        await mod.reclamarPushDelEquipo('emp-1');
        await mod.reclamarPushDelEquipo('emp-2');
        expect(reclamarPushSubscription).toHaveBeenCalledTimes(2);
    });

    it('sin empleado no hace nada', async () => {
        await expect(mod.reclamarPushDelEquipo(null)).resolves.toBe(null);
        expect(reclamarPushSubscription).not.toHaveBeenCalled();
    });

    it('sin suscripción devuelve null: nadie activó avisos en este equipo', async () => {
        montarNavegador(null);
        vi.resetModules();
        const m = await import('../../src/plataforma/pushEquipo');
        await expect(m.reclamarPushDelEquipo('emp-1')).resolves.toBe(null);
    });

    it('si la base falla devuelve FALSE, no true', async () => {
        // El false importa: el hook lo usa para dejar de decir que los avisos
        // están activos. Con un true optimista la persona vería la campanita en
        // verde sin recibir uno solo.
        reclamarPushSubscription.mockResolvedValue({ error: { message: 'RLS' } });
        await expect(mod.reclamarPushDelEquipo('emp-1')).resolves.toBe(false);
    });

    it('una excepción tampoco se convierte en true', async () => {
        reclamarPushSubscription.mockRejectedValue(new Error('red caída'));
        await expect(mod.reclamarPushDelEquipo('emp-1')).resolves.toBe(false);
    });
});

describe('soltar al cerrar sesión — el `if` que decide todo', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 204 }));
        globalThis.localStorage = {
            _v: JSON.stringify({ access_token: 'tok' }),
            getItem: () => globalThis.localStorage._v,
        };
    });
    afterEach(() => { delete globalThis.fetch; delete globalThis.localStorage; });

    const soltadoCon = () => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toMatch(/\/rest\/v1\/rpc\/soltar_push_del_equipo$/);
        return { token: opts.headers.Authorization, cuerpo: JSON.parse(opts.body) };
    };

    it('en el TELÉFONO no se suelta nunca', async () => {
        await mod.soltarPushDelEquipoSiEsCompartido('app');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('en una computadora compartida sí se suelta', async () => {
        await mod.soltarPushDelEquipoSiEsCompartido('navegador');
        expect(soltadoCon()).toEqual({ token: 'Bearer tok', cuerpo: { p_endpoint: 'https://push.example/abc' } });
    });

    it('una clase desconocida se trata como compartida', async () => {
        // Falla hacia el lado seguro: soltar de más deja a alguien sin avisos
        // hasta que vuelva a entrar; soltar de menos deja los avisos de una
        // persona cayendo en una pantalla ajena.
        await mod.soltarPushDelEquipoSiEsCompartido(undefined);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('sale con el token aunque la sesión se borre en el MISMO tick', async () => {
        // El defecto del 21-sep: `doLogout` llama a esto y sigue con `signOut()`
        // sin esperar. Cuando la llamada iba a buscar el token ya no había, salía
        // como `anon` y el servidor contestaba 401 — 300 de 361 cierres dejaron
        // el equipo ligado a quien se fue. El token se toma ANTES del primer
        // `await`, así que borrar la sesión después no lo alcanza.
        const soltando = mod.soltarPushDelEquipoSiEsCompartido('navegador');
        globalThis.localStorage._v = 'null';   // lo que hace `signOut()` en el mismo tick
        await soltando;
        expect(soltadoCon().token).toBe('Bearer tok');
    });

    it('usa el equipo ya recordado sin volver a preguntarle al navegador', async () => {
        await mod.reclamarPushDelEquipo('emp-1');
        montarNavegador(null);   // si le preguntara, no encontraría nada
        await mod.soltarPushDelEquipoSiEsCompartido('navegador');
        expect(soltadoCon().cuerpo).toEqual({ p_endpoint: 'https://push.example/abc' });
    });

    it('sin sesión guardada no manda nada: no hay a quién soltar', async () => {
        globalThis.localStorage._v = 'null';
        await mod.soltarPushDelEquipoSiEsCompartido('navegador');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('un fallo al soltar no lanza — el cierre de sesión sigue', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
        await expect(mod.soltarPushDelEquipoSiEsCompartido('navegador')).resolves.toBeUndefined();
        globalThis.fetch = vi.fn(async () => { throw new Error('red caída'); });
        await expect(mod.soltarPushDelEquipoSiEsCompartido('navegador')).resolves.toBeUndefined();
    });
});

describe('soltar cuando se va la PÁGINA', () => {
    const LS = 'sb-auth-token';
    beforeEach(() => {
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 204 }));
        globalThis.localStorage = {
            _v: JSON.stringify({ access_token: 'tok' }),
            getItem: () => globalThis.localStorage._v,
        };
    });
    afterEach(() => { delete globalThis.fetch; delete globalThis.localStorage; });

    it('SÍ manda, con keepalive y el token en la cabecera', async () => {
        // El caso positivo va PRIMERO a propósito: los cuatro de abajo afirman
        // que no se manda nada, y sin éste podrían estar pasando por el motivo
        // equivocado —por ejemplo, porque la URL de Supabase no esté definida en
        // el entorno de pruebas— en vez de por la lógica que dicen probar.
        await mod.reclamarPushDelEquipo('emp-1');
        mod.soltarPushAlCerrarLaPagina('navegador');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toMatch(/\/rest\/v1\/rpc\/soltar_push_del_equipo$/);
        // `keepalive` es la decisión: en `pagehide` el navegador mata las
        // peticiones en vuelo, y esto se la entrega al sistema para que
        // sobreviva a que la página muera. `sendBeacon` también sobrevive pero
        // NO deja poner cabeceras, y sin `Authorization` el servidor no sabe
        // quién suelta qué.
        expect(opts.keepalive).toBe(true);
        expect(opts.headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(opts.body)).toEqual({ p_endpoint: 'https://push.example/abc' });
    });

    it('y una sola vez: el segundo `pagehide` ya no tiene endpoint', async () => {
        await mod.reclamarPushDelEquipo('emp-1');
        mod.soltarPushAlCerrarLaPagina('navegador');
        mod.soltarPushAlCerrarLaPagina('navegador');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('no manda nada si nunca se reclamó el equipo', () => {
        // Sin endpoint recordado no hay a quién soltar. En `pagehide` no da
        // tiempo de preguntárselo al service worker: `getSubscription()` es
        // asíncrono y la página ya se está muriendo.
        mod.soltarPushAlCerrarLaPagina('navegador');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('en el teléfono no manda nada, aunque haya endpoint', async () => {
        // `pagehide` dispara cada vez que se cambia de aplicación: soltarlo ahí
        // desligaría el equipo todo el día.
        await mod.reclamarPushDelEquipo('emp-1');
        mod.soltarPushAlCerrarLaPagina('app');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('sin token guardado no manda nada', async () => {
        await mod.reclamarPushDelEquipo('emp-1');
        globalThis.localStorage._v = 'null';
        mod.soltarPushAlCerrarLaPagina('navegador');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('un localStorage con basura no rompe la salida', async () => {
        await mod.reclamarPushDelEquipo('emp-1');
        globalThis.localStorage._v = '{no soy json';
        expect(() => mod.soltarPushAlCerrarLaPagina('navegador')).not.toThrow();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
