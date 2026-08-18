import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { programarEn, TOPE_TIMEOUT_MS } from '../../src/utils/temporizadorLargo.js';

const DIA = 24 * 60 * 60 * 1000;

describe('programarEn', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('un plazo corto llega a su hora, no antes', () => {
        const ref = { current: null };
        const accion = vi.fn();
        programarEn(ref, Date.now() + 60_000, accion);
        vi.advanceTimersByTime(59_000);
        expect(accion).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_000);
        expect(accion).toHaveBeenCalledTimes(1);
    });

    it('30 días NO se disparan al instante — el bug de los teléfonos', () => {
        // `setTimeout(fn, 2_592_000_000)` desborda el entero de 32 bits y el
        // navegador lo corre ya. Era exactamente el límite de la app instalada.
        const ref = { current: null };
        const accion = vi.fn();
        programarEn(ref, Date.now() + 30 * DIA, accion);
        vi.advanceTimersByTime(10_000);
        expect(accion).not.toHaveBeenCalled();
        vi.advanceTimersByTime(25 * DIA);   // ya pasó un tramo entero
        expect(accion).not.toHaveBeenCalled();
    });

    it('30 días llegan, por tramos, a los 30 días', () => {
        const ref = { current: null };
        const accion = vi.fn();
        programarEn(ref, Date.now() + 30 * DIA, accion);
        vi.advanceTimersByTime(30 * DIA - 1_000);
        expect(accion).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_000);
        expect(accion).toHaveBeenCalledTimes(1);
    });

    it('un instante ya pasado corre enseguida, y una sola vez', () => {
        const ref = { current: null };
        const accion = vi.fn();
        programarEn(ref, Date.now() - 5_000, accion);
        vi.advanceTimersByTime(0);
        expect(accion).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60 * DIA);
        expect(accion).toHaveBeenCalledTimes(1);
    });

    it('cancelar el tramo en curso cancela todo el plazo', () => {
        const ref = { current: null };
        const accion = vi.fn();
        programarEn(ref, Date.now() + 30 * DIA, accion);
        clearTimeout(ref.current);
        vi.advanceTimersByTime(40 * DIA);
        expect(accion).not.toHaveBeenCalled();
    });

    it('el tope es el del entero de 32 bits con signo', () => {
        expect(TOPE_TIMEOUT_MS).toBe(2_147_483_647);
        expect(30 * DIA).toBeGreaterThan(TOPE_TIMEOUT_MS);   // por eso existe esto
    });
});
