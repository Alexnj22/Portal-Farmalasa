import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBusqueda, ESPERA_BUSQUEDA_MS } from '../../src/hooks/useBusqueda';

/**
 * El buscador que consulta a la base espera a que se termine de escribir.
 * Compras no esperaba: «amoxicilina» eran once consultas.
 */
describe('useBusqueda', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('aplica una sola vez, al terminar de escribir', () => {
        const { result } = renderHook(() => useBusqueda());
        for (const parcial of ['a', 'am', 'amo', 'amox']) {
            act(() => { result.current[1](parcial); });
            act(() => { vi.advanceTimersByTime(100); });
        }
        expect(result.current[0]).toBe('amox');
        expect(result.current[2]).toBe('');
        act(() => { vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS); });
        expect(result.current[2]).toBe('amox');
    });

    it('los espacios de los extremos no son otra búsqueda', () => {
        const { result } = renderHook(() => useBusqueda());
        act(() => { result.current[1]('  amox  '); });
        act(() => { vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS); });
        expect(result.current[2]).toBe('amox');
    });

    it('vaciar el buscador se aplica al instante', () => {
        const { result } = renderHook(() => useBusqueda('amox'));
        expect(result.current[2]).toBe('amox');
        act(() => { result.current[1](''); });
        expect(result.current[2]).toBe('');
    });
});
