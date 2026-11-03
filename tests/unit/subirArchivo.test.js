// La subida que no le cree al 504.
//
// Incidente 2026-11-02, Salud 1, 14:57–15:38: el servicio de archivos GUARDABA
// cada foto de boleta y se colgaba 60 s antes de contestar con un 504. El
// portal leía «no se subió» y la sala no pudo anotar ingresos del POS durante
// 40 minutos. Estas pruebas fabrican ese almacén y el que sí falla de verdad.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let upload, exists;
vi.mock('@nucleo/supabaseClient', () => ({
    supabase: {
        storage: {
            from: () => ({
                upload: (...a) => upload(...a),
                exists: (...a) => exists(...a),
                getPublicUrl: (p) => ({ data: { publicUrl: `https://x/storage/v1/object/public/b/${p}` } }),
            }),
        },
    },
}));

const { subirArchivo, esPasajero, esDuplicado } = await import('@nucleo/utils/storageFiles');

const URL_ESPERADA = 'https://x/storage/v1/object/public/b/bolsas/4/u/1.jpg';
const err = (status, message = 'x') => ({ status, message });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Corre la subida avanzando el reloj falso hasta que resuelva. */
async function correr(promesa) {
    let fin;
    promesa.then((v) => { fin = { v }; }, (e) => { fin = { e }; });
    for (let i = 0; i < 200 && !fin; i++) await vi.advanceTimersByTimeAsync(1_000);
    if (!fin) throw new Error('no terminó');
    if (fin.e) throw fin.e;
    return fin.v;
}

describe('subirArchivo', () => {
    it('camino feliz: una sola subida, sin preguntarle al bucket', async () => {
        upload = vi.fn(async () => ({ error: null }));
        exists = vi.fn();
        await expect(correr(subirArchivo('b', 'bolsas/4/u/1.jpg', {}))).resolves.toBe(URL_ESPERADA);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(exists).not.toHaveBeenCalled();
    });

    it('el incidente: guarda, se cuelga y no contesta → sigue apenas el archivo aparece', async () => {
        upload = vi.fn(() => new Promise((r) => setTimeout(() => r({ error: err(504, 'Gateway Timeout') }), 60_000)));
        exists = vi.fn(async () => ({ data: true }));
        const t0 = Date.now();
        await expect(correr(subirArchivo('b', 'bolsas/4/u/1.jpg', {}))).resolves.toBe(URL_ESPERADA);
        expect(Date.now() - t0).toBeLessThan(15_000);   // no espera los 60 s del 504
        expect(upload).toHaveBeenCalledTimes(1);
    });

    it('504 con el archivo guardado → éxito, sin reintentar', async () => {
        upload = vi.fn(async () => ({ error: err(504) }));
        exists = vi.fn(async () => ({ data: true }));
        await expect(correr(subirArchivo('b', 'bolsas/4/u/1.jpg', {}))).resolves.toBe(URL_ESPERADA);
        expect(upload).toHaveBeenCalledTimes(1);
    });

    it('504 sin archivo → reintenta y el segundo entra', async () => {
        upload = vi.fn()
            .mockResolvedValueOnce({ error: err(504) })
            .mockResolvedValueOnce({ error: null });
        exists = vi.fn(async () => ({ data: false }));
        await expect(correr(subirArchivo('b', 'bolsas/4/u/1.jpg', {}))).resolves.toBe(URL_ESPERADA);
        expect(upload).toHaveBeenCalledTimes(2);
    });

    it('en un reintento, «ya existe» es el intento anterior que llegó', async () => {
        upload = vi.fn()
            .mockResolvedValueOnce({ error: err(504) })
            .mockResolvedValueOnce({ error: err(409, 'The resource already exists') });
        exists = vi.fn().mockResolvedValueOnce({ data: false });
        await expect(correr(subirArchivo('b', 'bolsas/4/u/1.jpg', {}))).resolves.toBe(URL_ESPERADA);
    });

    it('en el PRIMER intento, «ya existe» es un choque de verdad y no se reintenta', async () => {
        upload = vi.fn(async () => ({ error: err(409, 'The resource already exists') }));
        exists = vi.fn(async () => ({ data: true }));
        await expect(correr(subirArchivo('b', 'p', {}))).rejects.toThrow(/already exists/);
        expect(upload).toHaveBeenCalledTimes(1);
    });

    it('un 403 (permiso) no se reintenta ni se disfraza', async () => {
        upload = vi.fn(async () => ({ error: err(403, 'new row violates row-level security policy') }));
        exists = vi.fn();
        await expect(correr(subirArchivo('b', 'p', {}))).rejects.toThrow(/row-level security/);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(exists).not.toHaveBeenCalled();
    });

    it('caído de verdad: tres intentos y un mensaje que dice qué hacer', async () => {
        upload = vi.fn(async () => ({ error: err(503) }));
        exists = vi.fn(async () => ({ data: false }));
        await expect(correr(subirArchivo('b', 'p', {}))).rejects.toThrow(/no está respondiendo/);
        expect(upload).toHaveBeenCalledTimes(3);
    });

    it('si preguntar también falla, no afirma que el archivo está', async () => {
        upload = vi.fn(async () => ({ error: err(504) }));
        exists = vi.fn(async () => { throw new Error('red'); });
        await expect(correr(subirArchivo('b', 'p', {}))).rejects.toThrow(/no está respondiendo/);
    });
});

describe('clasificar el error', () => {
    it('sin estado, 408, 429 y 5xx son pasajeros; 4xx no', () => {
        expect(esPasajero({ message: 'Failed to fetch' })).toBe(true);
        expect(esPasajero(err(504))).toBe(true);
        expect(esPasajero(err(429))).toBe(true);
        expect(esPasajero(err(413))).toBe(false);
        expect(esPasajero({ originalError: { status: 502 } })).toBe(true);
    });
    it('reconoce el duplicado por estado o por texto', () => {
        expect(esDuplicado(err(409))).toBe(true);
        expect(esDuplicado({ message: 'Duplicate' })).toBe(true);
        expect(esDuplicado(err(400, 'otro'))).toBe(false);
    });
});
