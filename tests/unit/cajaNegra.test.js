// Sistema — la caja negra, que es lo que queda cuando el portal se cae.
//
// El área no tenía ni una prueba, y ésta es la pieza que más lo necesita: se
// escribe justo cuando algo está fallando, y si falla ELLA no queda rastro de
// nada. Su propio comentario lo dice — «una caja negra que rompe la app que
// viene a diagnosticar no sirve».
//
// Se prueban las tres promesas que hace:
//   · no lanza nunca, pase lo que pase con `localStorage`;
//   · se queda con los ÚLTIMOS eventos, que son los que explican la caída;
//   · un registro ilegible se lee como vacío en vez de romper la lectura.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { anotar, leerCajaNegra, limpiarCajaNegra } from '../../src/utils/cajaNegra';

const CLAVE = 'portal_caja_negra';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('anotar un evento', () => {
    it('guarda tipo, momento y ruta', () => {
        const e = anotar('error-js', { mensaje: 'boom' });
        expect(e.tipo).toBe('error-js');
        expect(e.mensaje).toBe('boom');
        expect(e.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(typeof e.ruta).toBe('string');
        expect(leerCajaNegra()).toHaveLength(1);
    });

    it('acumula en orden: lo último queda al final', () => {
        anotar('uno'); anotar('dos'); anotar('tres');
        expect(leerCajaNegra().map(x => x.tipo)).toEqual(['uno', 'dos', 'tres']);
    });

    it('se queda con los últimos 40 y descarta los primeros', () => {
        // El recorte va por el PRINCIPIO a propósito: cuando el portal se cae,
        // lo que explica la caída son los últimos eventos, no los primeros. Un
        // tope que descartara por el final guardaría el arranque de la sesión y
        // tiraría justamente el momento del fallo.
        for (let i = 1; i <= 45; i++) anotar(`e${i}`);
        const reg = leerCajaNegra();
        expect(reg).toHaveLength(40);
        expect(reg[0].tipo).toBe('e6');
        expect(reg.at(-1).tipo).toBe('e45');
    });

    it('el detalle no puede pisar el tipo ni el momento', () => {
        // `{ t, tipo, ruta, ...detalle }` — el detalle se expande AL FINAL, así
        // que sí puede pisarlos. Queda anclado porque es el comportamiento real
        // y alguien podría anotar `{ tipo: … }` sin saberlo.
        const e = anotar('real', { tipo: 'falso' });
        expect(e.tipo).toBe('falso');
    });
});

describe('no rompe la app que viene a diagnosticar', () => {
    it('si localStorage no deja escribir, devuelve null y sigue', () => {
        // Modo privado de Safari y cuota llena: los dos lanzan. Si `anotar`
        // propagara la excepción, el manejador de errores que la llamó
        // reventaría — y el fallo original se perdería detrás de otro.
        // Se espía la INSTANCIA y no `Storage.prototype`: en jsdom
        // `localStorage` trae sus propios métodos como propiedades propias, así
        // que un espía sobre el prototipo no lo intercepta — la primera versión
        // de esta prueba falló por eso y parecía un defecto del código.
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => anotar('error-js')).not.toThrow();
        expect(anotar('error-js')).toBeNull();
    });

    it('si localStorage no deja leer, la caja se lee vacía', () => {
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(() => leerCajaNegra()).not.toThrow();
        expect(leerCajaNegra()).toEqual([]);
    });

    it('un registro con basura adentro se lee vacío, no rompe', () => {
        localStorage.setItem(CLAVE, '{no soy json');
        expect(leerCajaNegra()).toEqual([]);
        // Y se puede seguir anotando encima: la basura no deja la caja inservible.
        expect(anotar('despues')).not.toBeNull();
        expect(leerCajaNegra().map(x => x.tipo)).toEqual(['despues']);
    });

    it('un registro que es JSON pero no una lista se lee vacío', () => {
        // `JSON.parse('{"a":1}')` da un objeto, y `.push` sobre un objeto lanza.
        // Por eso hay un `Array.isArray` — esta prueba es la que lo sostiene.
        localStorage.setItem(CLAVE, '{"a":1}');
        expect(leerCajaNegra()).toEqual([]);
        expect(() => anotar('igual')).not.toThrow();
    });
});

describe('limpiar', () => {
    it('vacía la caja', () => {
        anotar('uno'); anotar('dos');
        expect(leerCajaNegra()).toHaveLength(2);
        limpiarCajaNegra();
        expect(leerCajaNegra()).toEqual([]);
    });

    it('limpiar una caja vacía no rompe', () => {
        expect(() => limpiarCajaNegra()).not.toThrow();
        expect(leerCajaNegra()).toEqual([]);
    });
});
