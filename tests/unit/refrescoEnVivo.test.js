import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRefrescoEnVivo } from '../../src/hooks/useRefrescoEnVivo';

/**
 * Que la pantalla se ponga al día sola.
 *
 * Nació de las bolsas de efectivo: «si estamos 2 o 3 personas contando, debo
 * actualizar para ver cuáles faltan» (usuario, 2026-08-31). Cada prueba ancla
 * una de las cuatro cosas que separan esto de un `setInterval` suelto — y las
 * cuatro fallan **en silencio**: una lista que se dejó de refrescar se ve
 * exactamente igual que una que está al día.
 */

const verse = (estado) => {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true, get: () => estado,
    });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

describe('el refresco en vivo', () => {
    beforeEach(() => { vi.useFakeTimers(); verse('visible'); });
    afterEach(() => { vi.useRealTimers(); });

    it('vuelve a leer cada intervalo, y no antes', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 20_000 }));

        act(() => { vi.advanceTimersByTime(19_000); });
        expect(leer).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(6_000); });
        expect(leer).toHaveBeenCalledTimes(1);

        act(() => { vi.advanceTimersByTime(20_000); });
        expect(leer).toHaveBeenCalledTimes(2);
    });

    it('no consulta con la pestaña oculta', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 20_000 }));

        verse('hidden');
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(leer).not.toHaveBeenCalled();
    });

    it('al volver la pestaña cobra lo que se saltó', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 20_000 }));

        verse('hidden');
        act(() => { vi.advanceTimersByTime(120_000); });
        verse('visible');
        expect(leer).toHaveBeenCalledTimes(1);
    });

    it('volver a la pestaña ANTES de que venza no gasta una consulta', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 20_000 }));

        verse('hidden');
        act(() => { vi.advanceTimersByTime(3_000); });
        verse('visible');
        expect(leer).not.toHaveBeenCalled();
    });

    it('en pausa no lee, y al reanudar se pone al día', () => {
        const leer = vi.fn();
        const { rerender } = renderHook(
            ({ activo }) => useRefrescoEnVivo(leer, { ms: 20_000, activo }),
            { initialProps: { activo: false } },
        );

        act(() => { vi.advanceTimersByTime(120_000); });
        expect(leer).not.toHaveBeenCalled();

        rerender({ activo: true });
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(leer).toHaveBeenCalledTimes(1);
    });

    it('usa la última función que le pasaron, no la del primer render', () => {
        const vieja = vi.fn();
        const nueva = vi.fn();
        const { rerender } = renderHook(({ fn }) => useRefrescoEnVivo(fn, { ms: 20_000 }),
            { initialProps: { fn: vieja } });

        rerender({ fn: nueva });
        act(() => { vi.advanceTimersByTime(25_000); });

        expect(vieja).not.toHaveBeenCalled();
        expect(nueva).toHaveBeenCalledTimes(1);
    });

    it('al desmontar deja de leer', () => {
        const leer = vi.fn();
        const { unmount } = renderHook(() => useRefrescoEnVivo(leer, { ms: 20_000 }));

        unmount();
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(leer).not.toHaveBeenCalled();
    });
});
