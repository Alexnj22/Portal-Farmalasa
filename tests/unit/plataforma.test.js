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
