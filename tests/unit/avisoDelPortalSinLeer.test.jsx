import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen, renderHook, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// El aviso del portal que no se pudo leer no se puede guardar (2026-11-23).
//
// `useBannerPortal` se tragaba el error de lectura (banner = null) y la
// pantalla de Mantenimiento pintaba el formulario vacío y APAGADO. Escribir un
// texto y «Guardar» mandaba `activo: false`: apagaba un aviso encendido. Ahora
// el hook expone el error y la pantalla muestra «Reintentar» sin formulario.
// ═══════════════════════════════════════════════════════════════════════════

const m = vi.hoisted(() => ({
    fetchBannerPortal: vi.fn(),
    guardarBannerPortal: vi.fn(),
    hook: null,
}));

vi.mock('@nucleo/supabaseClient', () => ({
    supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} },
}));

vi.mock('@nucleo/data/bannerPortal', async (orig) => ({
    ...(await orig()),
    fetchBannerPortal: m.fetchBannerPortal,
}));

describe('useBannerPortal — el error de lectura se expone', () => {
    beforeEach(() => { cleanup(); m.fetchBannerPortal.mockReset(); });

    it('lectura fallida → error presente y banner null', async () => {
        m.fetchBannerPortal.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
        const { useBannerPortal } = await import('@nucleo/hooks/useBannerPortal');
        const { result } = renderHook(() => useBannerPortal());
        await waitFor(() => expect(result.current.cargando).toBe(false));
        expect(result.current.banner).toBeNull();
        expect(result.current.error).toBeTruthy();
    });

    it('lectura buena → sin error', async () => {
        m.fetchBannerPortal.mockResolvedValue({ data: { activo: true, texto: 'Hola' }, error: null });
        const { useBannerPortal } = await import('@nucleo/hooks/useBannerPortal');
        const { result } = renderHook(() => useBannerPortal());
        await waitFor(() => expect(result.current.cargando).toBe(false));
        expect(result.current.error).toBeNull();
        expect(result.current.banner.activo).toBe(true);
    });
});
