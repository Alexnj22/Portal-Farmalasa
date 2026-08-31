import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/* El canal, fingido. Guarda el handler de `postgres_changes` para poder
 * disparar un aviso a mano, y cuenta los canales quitados: un canal que no se
 * quita al desmontar es una fuga que no da error — la vista se cierra y el
 * socket sigue trayendo avisos a un componente que ya no existe. */
const canales = [];
vi.mock('../../src/supabaseClient', () => ({
    supabase: {
        channel: (topico) => {
            const c = { topico, handler: null, suscrito: false, quitado: false };
            c.on = (_tipo, _filtro, fn) => { c.handler = fn; return c; };
            c.subscribe = () => { c.suscrito = true; return c; };
            canales.push(c);
            return c;
        },
        removeChannel: (c) => { c.quitado = true; },
    },
}));

const { useRefrescoEnVivo } = await import('../../src/hooks/useRefrescoEnVivo');

/** Un cambio en la tabla, como lo mandaría la base. */
const avisoDeLaBase = () => act(() => { canales.at(-1).handler?.({}); });

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
    beforeEach(() => { vi.useFakeTimers(); verse('visible'); canales.length = 0; });
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

    it('sin `tabla` no abre ningún canal', () => {
        renderHook(() => useRefrescoEnVivo(vi.fn(), { ms: 20_000 }));
        expect(canales).toHaveLength(0);
    });

    it('un aviso de la base lee, sin esperar el reloj', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 60_000, tabla: 'bolsas' }));

        avisoDeLaBase();
        act(() => { vi.advanceTimersByTime(500); });
        expect(leer).toHaveBeenCalledTimes(1);
    });

    it('treinta avisos seguidos son UNA lectura', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 60_000, tabla: 'bolsas' }));

        // Confirmar un conteo de treinta bolsas es un UPDATE por bolsa.
        for (let i = 0; i < 30; i += 1) {
            avisoDeLaBase();
            act(() => { vi.advanceTimersByTime(20); });
        }
        act(() => { vi.advanceTimersByTime(500); });
        expect(leer).toHaveBeenCalledTimes(1);
    });

    it('el aviso pone el reloj en hora: no consulta de nuevo un segundo después', () => {
        const leer = vi.fn();
        renderHook(() => useRefrescoEnVivo(leer, { ms: 20_000, tabla: 'bolsas' }));

        act(() => { vi.advanceTimersByTime(19_000); });
        avisoDeLaBase();
        act(() => { vi.advanceTimersByTime(500); });
        expect(leer).toHaveBeenCalledTimes(1);

        // El reloj habría vencido a los 20 s desde el montaje; ya no, porque la
        // pantalla se leyó recién.
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(leer).toHaveBeenCalledTimes(1);
    });

    it('un aviso durante la pausa no se pierde: se lee al reanudar', () => {
        const leer = vi.fn();
        const { rerender } = renderHook(
            ({ activo }) => useRefrescoEnVivo(leer, { ms: 60_000, tabla: 'bolsas', activo }),
            { initialProps: { activo: true } },
        );

        rerender({ activo: false });
        avisoDeLaBase();
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(leer).not.toHaveBeenCalled();

        rerender({ activo: true });
        expect(leer).toHaveBeenCalledTimes(1);
    });

    it('al desmontar quita el canal', () => {
        const { unmount } = renderHook(() => useRefrescoEnVivo(vi.fn(), { tabla: 'bolsas' }));
        expect(canales.at(-1).suscrito).toBe(true);

        unmount();
        expect(canales.at(-1).quitado).toBe(true);
    });

    it('dos vistas sobre la misma tabla no comparten el tema del canal', () => {
        renderHook(() => useRefrescoEnVivo(vi.fn(), { tabla: 'bolsas' }));
        renderHook(() => useRefrescoEnVivo(vi.fn(), { tabla: 'bolsas' }));

        expect(canales).toHaveLength(2);
        expect(canales[0].topico).not.toBe(canales[1].topico);
    });
});
