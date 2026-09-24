// @vitest-environment jsdom
//
// Los adaptadores de `src/plataforma/` son pasamanos: mudar una llamada de
// `localStorage`/`window` a ellos NO puede cambiar ningún comportamiento. Esto
// ancla las tres cosas que se romperían en silencio si alguien los "mejorara":
// que el aviso le siga llegando a quien escucha con `window.addEventListener`
// (las pantallas todavía lo hacen), con el mismo `detail`; que el almacén use
// las MISMAS claves de `localStorage` (lo ya guardado en cada navegador se
// sigue leyendo); y que un error del navegador se siga propagando.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as almacen from '../../src/plataforma/almacen';
import { emitir, escuchar } from '../../src/plataforma/eventos';

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('almacen', () => {
    it('lee y escribe las mismas claves de localStorage', () => {
        localStorage.setItem('sb_user', '{"id":1}');
        expect(almacen.leer('sb_user')).toBe('{"id":1}');
        almacen.guardar('cache_roles', '[]');
        expect(localStorage.getItem('cache_roles')).toBe('[]');
        almacen.borrar('sb_user');
        expect(localStorage.getItem('sb_user')).toBeNull();
        expect(almacen.leer('no-existe')).toBeNull();
        expect(almacen.claves()).toEqual(['cache_roles']);
    });

    it('la sesión va a sessionStorage, no a localStorage', () => {
        almacen.deLaSesion.guardar('x', '1');
        expect(sessionStorage.getItem('x')).toBe('1');
        expect(localStorage.getItem('x')).toBeNull();
    });

    it('un error del navegador se propaga igual que antes (cuota llena)', () => {
        vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('lleno', 'QuotaExceededError'); });
        expect(() => almacen.guardar('a', 'b')).toThrow('lleno');
    });
});

describe('eventos', () => {
    it('le llega a quien escucha en window, sin detalle', () => {
        const visto = vi.fn();
        window.addEventListener('force-history-refresh', visto);
        emitir('force-history-refresh');
        expect(visto).toHaveBeenCalledTimes(1);
        expect(visto.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
        expect(visto.mock.calls[0][0].detail).toBeNull();   // igual que `new CustomEvent(nombre)`
        window.removeEventListener('force-history-refresh', visto);
    });

    it('con el mismo detail que antes', () => {
        const visto = vi.fn();
        window.addEventListener('employee-event-updated', visto);
        emitir('employee-event-updated', { employeeId: 7 });
        expect(visto.mock.calls[0][0].detail).toEqual({ employeeId: 7 });
        window.removeEventListener('employee-event-updated', visto);
    });

    it('escuchar entrega el detail y se puede soltar', () => {
        const visto = vi.fn();
        const soltar = escuchar('x', visto);
        emitir('x', { a: 1 });
        soltar();
        emitir('x', { a: 2 });
        expect(visto).toHaveBeenCalledTimes(1);
        expect(visto).toHaveBeenCalledWith({ a: 1 });
    });
});

// El cierre por inactividad engancha los oyentes en un lugar y los suelta en
// otro, con la identidad de la función como llave. Si `soltar` no quitara
// exactamente lo que `escuchar` puso —mismo tipo, misma fase de captura—, el
// vigilante de una sesión cerrada seguiría vivo y cerraría la siguiente.
describe('cicloDeVida', async () => {
    const cv = await import('../../src/plataforma/cicloDeVida');

    it('la actividad son los cinco eventos de siempre, en captura, y se sueltan todos', () => {
        const fn = vi.fn();
        cv.escucharActividad(fn);
        for (const t of ['mousemove', 'keydown', 'wheel', 'click', 'touchstart']) window.dispatchEvent(new Event(t));
        expect(fn).toHaveBeenCalledTimes(5);
        cv.soltarActividad(fn);
        for (const t of ['mousemove', 'keydown', 'wheel', 'click', 'touchstart']) window.dispatchEvent(new Event(t));
        expect(fn).toHaveBeenCalledTimes(5);
    });

    it('visibilidad: soltar con la misma captura quita el oyente', () => {
        const fn = vi.fn();
        cv.escucharVisibilidad(fn, true);
        document.dispatchEvent(new Event('visibilitychange'));
        cv.soltarVisibilidad(fn, true);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('visibilidad() es el texto del navegador, no un booleano', () => {
        expect(cv.visibilidad()).toBe(document.visibilityState);
    });

    it('salida es pagehide', () => {
        const fn = vi.fn();
        cv.escucharSalida(fn);
        window.dispatchEvent(new Event('pagehide'));
        cv.soltarSalida(fn);
        window.dispatchEvent(new Event('pagehide'));
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
