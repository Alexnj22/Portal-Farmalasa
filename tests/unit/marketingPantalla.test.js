import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESTADOS_PIEZA, FORMATOS } from '@nucleo/utils/marketing';
import { COLORES_MARCA, ICONOS_FORMATO, ICONO_DESCONOCIDO, puntoDeMarca, tintaDeMarca, tonoDeEstado } from '../../src/views/marketing/iconos';
import { medirArchivo } from '../../src/views/marketing/medir';

// Lo que la pantalla de marketing resuelve por su cuenta: el ícono y el color
// que el núcleo sólo NOMBRA, y las medidas del archivo antes de subirlo.

describe('iconos.js — lo que el núcleo nombra, la pantalla lo tiene', () => {
    it('cada formato del núcleo tiene su ícono', () => {
        for (const f of FORMATOS) expect(ICONOS_FORMATO[f.icono], f.value).toBeTruthy();
    });

    it('cada estado de una pieza tiene su tono propio (ninguno cae al de pendiente por omisión)', () => {
        for (const e of ESTADOS_PIEZA) {
            const t = tonoDeEstado(e.value);
            expect(t.icono, e.value).toBeTruthy();
            if (e.value !== 'pendiente') expect(t, e.value).not.toBe(tonoDeEstado('pendiente'));
        }
    });

    it('un estado desconocido se pinta como pendiente, no revienta', () => {
        expect(tonoDeEstado('inventado')).toBe(tonoDeEstado('pendiente'));
    });

    it('un color de marca retirado (chart-2, 5, 7) cae al primero vigente', () => {
        expect(COLORES_MARCA).not.toContain('chart-2');
        expect(puntoDeMarca('chart-2')).toBe('bg-chart-1');
        expect(tintaDeMarca(undefined)).toBe(tintaDeMarca('chart-1'));
        expect(puntoDeMarca('chart-6')).toBe('bg-chart-6');
    });

    it('un formato que el núcleo no conoce no tiene ícono propio: la pantalla usa el desconocido', () => {
        expect(ICONOS_FORMATO.Inventado).toBeUndefined();
        expect(ICONO_DESCONOCIDO).toBeTruthy();
        expect(Object.values(ICONOS_FORMATO)).not.toContain(ICONO_DESCONOCIDO);
    });
});

describe('medir.js — las medidas antes de subir', () => {
    const urlOriginal = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    afterEach(() => {
        URL.createObjectURL = urlOriginal.create;
        URL.revokeObjectURL = urlOriginal.revoke;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('sin archivo no mide nada', async () => {
        expect(await medirArchivo(null)).toEqual({ tamano: null, ancho: null, alto: null });
    });

    it('un PDF sólo lleva su tamaño, y no abre una URL que nadie va a liberar', async () => {
        URL.createObjectURL = vi.fn();
        expect(await medirArchivo({ size: 1234, type: 'application/pdf' })).toEqual({ tamano: 1234, ancho: null, alto: null });
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('una imagen trae ancho y alto y libera la URL', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:1');
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal('Image', class {
            set src(_) { this.naturalWidth = 1080; this.naturalHeight = 1920; setTimeout(() => this.onload(), 0); }
        });
        expect(await medirArchivo({ size: 10, type: 'image/png' })).toEqual({ tamano: 10, ancho: 1080, alto: 1920 });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    });

    it('un formato que el navegador no abre (HEIC) no la deja esperando: a los 4 s sigue sin medidas', async () => {
        vi.useFakeTimers();
        URL.createObjectURL = vi.fn(() => 'blob:2');
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal('Image', class { set src(_) { /* ni carga ni error */ } });
        const p = medirArchivo({ size: 99, type: 'image/heic' });
        await vi.advanceTimersByTimeAsync(4000);
        expect(await p).toEqual({ tamano: 99, ancho: null, alto: null });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2');
    });
});
