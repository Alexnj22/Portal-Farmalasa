// La pestaña activa vive en la DIRECCIÓN, no en la memoria del componente.
//
// Una pestaña en `useState` se pierde con cualquier recarga: apretar F5 —o
// volver por el historial, o abrir el enlace que alguien pasó— devuelve a la
// primera sin decir nada. Y como no falla nada, no se reporta como un bug sino
// como «la pantalla se movió sola».
//
// Medido el 2026-08-20: de las 29 vistas con pestañas, **9 lo hacían bien y 20
// no**. Nueve resolvían lo mismo a mano con el mismo bloque de cinco líneas, y
// la parte que se olvida al copiarlo es **la validación contra las pestañas
// realmente visibles**: sin ella, un `?tab=loquesea` —o una pestaña que el
// permiso del usuario no incluye— deja la vista pintando el vacío.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { usePestanaEnUrl } from '../../src/hooks/usePestanaEnUrl';
import { useNowTick } from '../../src/hooks/useNowTick';
import { vi, beforeEach, afterEach } from 'vitest';

/** Monta el hook con una dirección inicial. */
function montar(pestanas, { url = '/x', porDefecto, param } = {}) {
    return renderHook(() => usePestanaEnUrl(pestanas, porDefecto, param), {
        wrapper: ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>,
    });
}

const TRES = ['ventas', 'anuladas', 'pendiente-mh'];

describe('de dónde sale la pestaña activa', () => {
    it('sin nada en la dirección, la primera', () => {
        expect(montar(TRES).result.current[0]).toBe('ventas');
    });

    it('la dirección MANDA sobre el orden', () => {
        // Es lo que hace que compartir el enlace lleve a donde uno estaba.
        expect(montar(TRES, { url: '/x?tab=pendiente-mh' }).result.current[0]).toBe('pendiente-mh');
    });

    it('una pestaña que NO existe cae al default, no deja la vista vacía', () => {
        expect(montar(TRES, { url: '/x?tab=inventada' }).result.current[0]).toBe('ventas');
    });

    it('el default explícito manda… mientras siga visible', () => {
        expect(montar(TRES, { porDefecto: 'anuladas' }).result.current[0]).toBe('anuladas');
    });

    it('…y si el permiso se lo llevó, gana la primera que le QUEDÓ', () => {
        // La única respuesta honesta: el default apunta a algo que esa persona
        // no puede ver.
        expect(montar(['anuladas', 'pendiente-mh'], { porDefecto: 'ventas' }).result.current[0])
            .toBe('anuladas');
    });

    it('acepta pestañas como texto, como `key`, como `id` y como `value`', () => {
        // Las TRES formas conviven en el repo —`ViewTabBar` pide `key`, las del
        // tablero se escribieron con `id`, las opciones de `FilterBar` usan
        // `value`— y el hook no es motivo para reescribir ninguna de esas listas.
        expect(montar([{ key: 'a' }, { key: 'b' }], { url: '/x?tab=b' }).result.current[0]).toBe('b');
        expect(montar([{ id: 'a' }, { id: 'b' }], { url: '/x?tab=b' }).result.current[0]).toBe('b');
        expect(montar([{ value: 'a' }, { value: 'b' }], { url: '/x?tab=b' }).result.current[0]).toBe('b');
    });

    it('con `value`, una lista sin claves reconocibles NO deja la vista clavada', () => {
        // La regresión que esto ancla, y su modo de falla: antes de reconocer
        // `value`, una lista de opciones de `FilterBar` producía `claves` VACÍO.
        // Con eso `activa` era siempre el default y la dirección se ignoraba —
        // pero el clic SÍ escribía el `?tab=` en la barra. La URL decía una cosa
        // y la pantalla mostraba otra, y no fallaba nada. Pasó en `/personal`.
        const opciones = [
            { value: 'todos', label: 'Todos' },
            { value: 'externos', label: 'Externos y sistema' },
        ];
        expect(montar(opciones, { url: '/x?tab=externos' }).result.current[0]).toBe('externos');
    });

    it('sin pestañas visibles no inventa una', () => {
        expect(montar([]).result.current[0]).toBeNull();
    });

    it('el nombre del parámetro se puede cambiar', () => {
        // Dos barras de pestañas en la misma vista necesitan direcciones
        // distintas.
        expect(montar(TRES, { url: '/x?sub=anuladas', param: 'sub' }).result.current[0]).toBe('anuladas');
    });
});

describe('cambiar de pestaña escribe la dirección', () => {
    it('un clic empuja al historial: «atrás» deshace el cambio', () => {
        // Es lo que espera quien llegó a la tercera y quiere volver a la
        // segunda.
        const { result } = montar(TRES);
        act(() => result.current[1]('anuladas'));
        expect(result.current[0]).toBe('anuladas');
    });

    it('una CORRECCIÓN reemplaza en vez de empujar', () => {
        // Cuando la vista se cae sola a otra pestaña porque a la de la dirección
        // le falta permiso, empujar al historial deja a «atrás» rebotando contra
        // la misma corrección y la pantalla queda sin salida por ese botón.
        const { result } = montar(TRES);
        act(() => result.current[1]('anuladas', { reemplazar: true }));
        expect(result.current[0]).toBe('anuladas');
    });

    it('conserva los otros parámetros de la dirección', () => {
        // Un `setSearchParams` que reescribe todo se lleva el filtro, la página
        // y el período que ya estaban puestos — y la vista vuelve al inicio sin
        // que nadie lo haya pedido.
        const { result } = renderHook(() => {
            const [params] = useSearchParams();
            const [activa, setActiva] = usePestanaEnUrl(TRES);
            return { activa, setActiva, params };
        }, {
            wrapper: ({ children }) =>
                <MemoryRouter initialEntries={['/x?tab=ventas&sucursal=4&pagina=3']}>{children}</MemoryRouter>,
        });

        act(() => result.current.setActiva('anuladas'));
        expect(result.current.activa).toBe('anuladas');
        expect(result.current.params.get('sucursal')).toBe('4');
        expect(result.current.params.get('pagina')).toBe('3');
    });
});

describe('el reloj que avanza solo', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('avanza sin que el componente vuelva a renderizar por otra razón', () => {
        // Un «hace X días» que sale de `Date.now()` en el render queda congelado
        // en el valor del último render, y se desincroniza sin que nada falle.
        vi.setSystemTime(new Date('2026-08-24T14:00:00Z'));
        const { result } = renderHook(() => useNowTick(60_000));
        const primero = result.current;
        act(() => { vi.setSystemTime(new Date('2026-08-24T14:02:00Z')); vi.advanceTimersByTime(120_000); });
        expect(result.current).toBeGreaterThan(primero);
    });

    it('se apaga al desmontar: un intervalo huérfano renderiza para siempre', () => {
        const { unmount } = renderHook(() => useNowTick(1000));
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
