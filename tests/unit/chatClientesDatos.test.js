import { describe, expect, it, vi, beforeEach } from 'vitest';

// La capa de datos del chat con clientes: firmas de archivos reutilizadas,
// el orden de los mensajes, las reacciones en tandas (el `mensaje_id` se
// repite, así que acotar la entrada no acota la salida — CLAUDE.md, Patrón A)
// y la ruta donde sube el equipo, que es la única que la policy le deja.

const pedidas = [];
let responder = () => ({ data: [], error: null });
const firmar = vi.fn();
const subir = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('@nucleo/supabaseClient', () => {
    const cadena = (tabla) => {
        const q = { tabla, ops: [] };
        const p = new Proxy({}, {
            get(_, op) {
                if (op === 'then') return (res, rej) => { pedidas.push(q); return Promise.resolve(responder(q)).then(res, rej); };
                return (...a) => { q.ops.push([op, ...a]); return p; };
            },
        });
        return p;
    };
    return { supabase: {
        from: cadena,
        rpc: vi.fn(async () => ({ data: null, error: null })),
        storage: { from: () => ({ createSignedUrls: (...a) => firmar(...a), upload: (...a) => subir(...a) }) },
    } };
});
vi.mock('@nucleo/data/audit', () => ({ anotar: vi.fn() }));

const chat = await import('@nucleo/data/chatClientes');
const { anotar } = await import('@nucleo/data/audit');
const { supabase } = await import('@nucleo/supabaseClient');

beforeEach(() => {
    pedidas.length = 0; vi.clearAllMocks();
    responder = () => ({ data: [], error: null });
    firmar.mockImplementation(async (rutas) => ({ data: rutas.map((p) => ({ path: p, signedUrl: `${p}?f=${Math.random()}` })), error: null }));
});

describe('firmarRutas — una firma se reutiliza mientras le quede tiempo', () => {
    it('no vuelve a firmar lo ya firmado (la foto no se vuelve a bajar)', async () => {
        const a = await chat.firmarRutas(['x/1.jpg', 'x/1.jpg', null]);
        const b = await chat.firmarRutas(['x/1.jpg', 'x/2.jpg']);
        expect(firmar).toHaveBeenCalledTimes(2);
        expect(firmar.mock.calls[0][0]).toEqual(['x/1.jpg']);
        expect(firmar.mock.calls[1][0]).toEqual(['x/2.jpg']);
        expect(b.get('x/1.jpg')).toBe(a.get('x/1.jpg'));
    });

    it('si la firma falla devuelve lo que ya tenía, sin lanzar', async () => {
        const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
        firmar.mockResolvedValueOnce({ data: null, error: new Error('x') });
        const r = await chat.firmarRutas(['y/nueva.jpg']);
        expect(r.size).toBe(0);
        consola.mockRestore();
    });
});

describe('fetchMensajes', () => {
    it('pide los últimos 50 del más nuevo al más viejo y los entrega en orden de llegada', async () => {
        responder = () => ({ data: [{ id: 3 }, { id: 2 }, { id: 1 }], error: null });
        const r = await chat.fetchMensajes('7');
        expect(r.map((m) => m.id)).toEqual([1, 2, 3]);
        const ops = pedidas[0].ops;
        expect(ops).toContainEqual(['eq', 'conversacion_id', 7]);
        expect(ops).toContainEqual(['order', 'id', { ascending: false }]);
        expect(ops).toContainEqual(['limit', chat.MENSAJES_POR_PAGINA]);
    });

    it('con cursores pide sólo la página anterior o lo nuevo', async () => {
        await chat.fetchMensajes(7, { antesDe: '40' });
        await chat.fetchMensajes(7, { despuesDe: 41 });
        expect(pedidas[0].ops).toContainEqual(['lt', 'id', 40]);
        expect(pedidas[1].ops).toContainEqual(['gt', 'id', 41]);
    });

    it('firma la foto y el audio/PDF del adjunto; otro adjunto no lleva archivo', async () => {
        responder = () => ({ data: [
            { id: 2, foto_ruta: 'chat/1/f.jpg', adjunto: null },
            { id: 1, foto_ruta: null, adjunto: { tipo: 'audio', ruta: 'chat/1/a.m4a' } },
            { id: 0, foto_ruta: null, adjunto: { tipo: 'producto', ruta: 'no/se/firma' } },
        ], error: null });
        const [m0, m1, m2] = await chat.fetchMensajes(1);
        expect(m0.archivo_url).toBeNull();
        expect(m1.archivo_url).toMatch(/^chat\/1\/a\.m4a\?f=/);
        expect(m2.foto_url).toMatch(/^chat\/1\/f\.jpg\?f=/);
    });

    it('sin desde, lo cambiado no consulta', async () => {
        expect(await chat.fetchMensajesCambiados(1, null)).toEqual([]);
        expect(pedidas).toHaveLength(0);
    });
});

describe('fetchReacciones — en tandas de 100 mensajes', () => {
    it('250 mensajes son tres consultas, y los ids repetidos o nulos no cuentan', async () => {
        const ids = [...Array.from({ length: 250 }, (_, i) => i + 1), 1, null];
        responder = (q) => ({ data: q.ops.find(([o]) => o === 'in')[2].map((id) => ({ mensaje_id: id })), error: null });
        const r = await chat.fetchReacciones(ids);
        expect(pedidas).toHaveLength(3);
        expect(pedidas.map((q) => q.ops.find(([o]) => o === 'in')[2].length)).toEqual([100, 100, 50]);
        expect(r).toHaveLength(250);
    });

    it('una tanda que llega al tope lo avisa (pueden faltar reacciones)', async () => {
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        responder = () => ({ data: Array.from({ length: 900 }, (_, i) => ({ id: i })), error: null });
        await chat.fetchReacciones([1]);
        expect(aviso).toHaveBeenCalled();
        aviso.mockRestore();
    });

    it('sin mensajes no consulta', async () => {
        expect(await chat.fetchReacciones([])).toEqual([]);
        expect(pedidas).toHaveLength(0);
    });
});

describe('lo que escribe el equipo', () => {
    it('la foto va a chat/<cliente>/equipo con la extensión de su tipo', async () => {
        const ruta = await chat.subirFotoDelEquipo('12', { type: 'image/png' });
        expect(ruta).toMatch(/^chat\/12\/equipo\/\d+\.png$/);
        expect(subir.mock.calls[0][2]).toEqual({ contentType: 'image/png', upsert: false });
    });

    it('la nota de voz va como audio/mp4 (la que abre el iPhone del cliente)', async () => {
        const ruta = await chat.subirAudioDelEquipo(12, { body: new ArrayBuffer(1) });
        expect(ruta).toMatch(/\.m4a$/);
        expect(subir.mock.calls[0][2].contentType).toBe('audio/mp4');
    });

    it('etiquetar reemplaza la lista sin repetidas y deja el antes y el después en la bitácora', async () => {
        await chat.etiquetarConversacion('5', ['vip', 'vip', '', 'receta'], ['vip']);
        expect(supabase.rpc).toHaveBeenCalledWith('chat_etiquetar', { p_conversacion: 5, p_etiquetas: ['vip', 'receta'] });
        expect(anotar).toHaveBeenCalledWith('CHAT_CLIENTE_ETIQUETAR', '5', { antes: ['vip'], despues: ['vip', 'receta'] });
    });

    it('resolver queda en la bitácora', async () => {
        await chat.resolverConversacion(5);
        expect(anotar).toHaveBeenCalledWith('CHAT_CLIENTE_RESOLVER', '5', {});
    });
});
