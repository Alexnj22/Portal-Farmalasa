import { describe, it, expect } from 'vitest';
import { pantallaDeArranque, PANTALLA } from '../../src/utils/arranqueSesion.js';

const base = { cargando: false, autenticado: true, permisos: { overview: { can_view: true } }, leyendoPermisos: false, falloDePermisos: false };

describe('pantallaDeArranque', () => {
    it('con permisos leídos, la app', () => {
        expect(pantallaDeArranque(base)).toBe(PANTALLA.APP);
    });

    it('permisos DESCONOCIDOS no son «sin módulos»: se espera', () => {
        // Éste es el bug del 2026-08-16. Antes, `permisos: null` con la lectura
        // ya terminada caía en la app, no encontraba ningún módulo con permiso
        // y redirigía a «Sin acceso — tu cuenta no tiene módulos habilitados»,
        // que además se quedaba pegado por el `replace`.
        expect(pantallaDeArranque({ ...base, permisos: null })).toBe(PANTALLA.SPLASH);
    });

    it('mientras se leen, se espera', () => {
        expect(pantallaDeArranque({ ...base, permisos: null, leyendoPermisos: true })).toBe(PANTALLA.SPLASH);
    });

    it('leídos y VACÍOS sí es la app: ahí «Sin acceso» dice la verdad', () => {
        expect(pantallaDeArranque({ ...base, permisos: {} })).toBe(PANTALLA.APP);
    });

    it('si la lectura falló, su propia pantalla — nunca «sin módulos»', () => {
        expect(pantallaDeArranque({ ...base, permisos: null, falloDePermisos: true })).toBe(PANTALLA.ERROR_PERMISOS);
    });

    it('sin sesión manda el router, pase lo que pase con los permisos', () => {
        expect(pantallaDeArranque({ ...base, autenticado: false, permisos: null })).toBe(PANTALLA.APP);
        expect(pantallaDeArranque({ ...base, autenticado: false, falloDePermisos: true })).toBe(PANTALLA.APP);
    });

    it('el arranque de la sesión gana sobre todo lo demás', () => {
        expect(pantallaDeArranque({ ...base, cargando: true, falloDePermisos: true })).toBe(PANTALLA.SPLASH);
    });
});
