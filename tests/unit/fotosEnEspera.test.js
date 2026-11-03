// La foto que no sube no frena el ingreso (2026-11-02, Salud 1).
//
// El ingreso entra con la URL definitiva, la foto espera en el aparato y se
// sube sola. Lo que estas pruebas cuidan:
//   · con el servicio caído, el comprobante devuelve la URL y `pendiente`;
//   · un error que NO es del servicio (permiso, tamaño) sigue frenando;
//   · si el aparato no puede guardar la foto, también frena (como antes);
//   · la cola sube, quita y le avisa a la base; con el servicio todavía mal,
//     deja todo donde estaba.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const cola = new Map();
vi.mock('@plataforma/archivosEnEspera', () => ({
    guardar: vi.fn(async (it) => { if (globalThis.__sinCola) throw new Error('sin IndexedDB'); cola.set(it.id, it); }),
    listar: vi.fn(async () => [...cola.values()]),
    quitar: vi.fn(async (id) => { cola.delete(id); }),
}));

const rpc = vi.fn(async () => ({ data: 1, error: null }));
vi.mock('@nucleo/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const subirArchivo = vi.fn();
vi.mock('@nucleo/utils/storageFiles', async (orig) => {
    const real = await orig();
    return {
        ...real,
        subirArchivo: (...a) => subirArchivo(...a),
        urlPublicaDe: (b, p) => `https://x/storage/v1/object/public/${b}/${p}`,
        signPhotosDeep: (x) => x,
    };
});

const { subirComprobanteOEncolar } = await import('@nucleo/data/bolsas');
const { vaciarFotosEnEspera, fotosEnEspera } = await import('@nucleo/data/fotosEnEspera');

const caido = () => Object.assign(new Error('El servicio de archivos no está respondiendo.'), { pasajero: true });
const foto = { name: 'boleta.jpg', type: 'image/jpeg' };

beforeEach(() => { cola.clear(); vi.clearAllMocks(); globalThis.__sinCola = false; });

describe('subirComprobanteOEncolar', () => {
    it('servicio bien: sube y no deja nada esperando', async () => {
        subirArchivo.mockResolvedValueOnce('https://x/ok.jpg');
        const r = await subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' });
        expect(r).toEqual({ url: 'https://x/ok.jpg', pendiente: false });
        expect(await fotosEnEspera()).toBe(0);
    });

    it('servicio caído: devuelve la URL DEFINITIVA y la foto queda esperando', async () => {
        subirArchivo.mockRejectedValueOnce(caido());
        const r = await subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' });
        expect(r.pendiente).toBe(true);
        expect(r.url).toMatch(/^https:\/\/x\/storage\/v1\/object\/public\/payment-proofs\/bolsas\/4\/u\/\d+\.jpg$/);
        expect(await fotosEnEspera()).toBe(1);
        // La URL que va a la base es exactamente la del archivo que espera.
        const [it] = cola.values();
        expect(r.url.endsWith(it.path)).toBe(true);
    });

    it('un error que no es del servicio sigue frenando', async () => {
        subirArchivo.mockRejectedValueOnce(Object.assign(new Error('row-level security'), { pasajero: false }));
        await expect(subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' })).rejects.toThrow(/row-level security/);
        expect(await fotosEnEspera()).toBe(0);
    });

    it('sin lugar donde guardar la foto, frena como antes', async () => {
        globalThis.__sinCola = true;
        subirArchivo.mockRejectedValueOnce(caido());
        await expect(subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' })).rejects.toThrow();
    });
});

describe('vaciarFotosEnEspera', () => {
    it('sube, quita y le avisa a la base', async () => {
        subirArchivo.mockRejectedValueOnce(caido());
        const { url } = await subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' });
        subirArchivo.mockResolvedValueOnce(url);
        expect(await vaciarFotosEnEspera()).toBe(0);
        expect(rpc).toHaveBeenCalledWith('confirmar_foto_pendiente', { p_url: url });
    });

    it('«ya existe» es el intento colgado que sí llegó: se da por subida', async () => {
        subirArchivo.mockRejectedValueOnce(caido());
        await subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' });
        subirArchivo.mockRejectedValueOnce(new Error('The resource already exists'));
        expect(await vaciarFotosEnEspera()).toBe(0);
    });

    it('con el servicio todavía mal, todo queda esperando', async () => {
        subirArchivo.mockRejectedValueOnce(caido());
        await subirComprobanteOEncolar(foto, { salaId: 4, userId: 'u' });
        subirArchivo.mockRejectedValueOnce(caido());
        expect(await vaciarFotosEnEspera()).toBe(1);
        expect(rpc).not.toHaveBeenCalledWith('confirmar_foto_pendiente', expect.anything());
    });
});
