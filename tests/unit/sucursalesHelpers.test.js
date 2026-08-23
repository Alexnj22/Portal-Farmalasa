// Sucursales — los tres ayudantes que tocan lo que se escribe en el expediente.
//
// El área no tenía ni una prueba. `clampInt`, `formatPhoneMask` y `safeParse`
// son chicos, pero los tres están en el camino de GUARDAR: el expediente de una
// sala es donde viven el teléfono al que se llama, los datos del inmueble y la
// configuración legal. Los tres fallan del mismo modo —devolviendo algo
// razonable en vez de nada— y por eso conviene fijar exactamente qué devuelven.

import { describe, it, expect } from 'vitest';
import { clampInt, formatPhoneMask, safeParse } from '../../src/components/forms/BranchHelpers';

describe('clampInt — un número dentro de su rango', () => {
    it('deja pasar lo que ya está adentro', () => {
        expect(clampInt(5, 1, 10)).toBe(5);
        expect(clampInt('5', 1, 10)).toBe(5);
        expect(clampInt(1, 1, 10)).toBe(1);
        expect(clampInt(10, 1, 10)).toBe(10);
    });

    it('recorta a los extremos', () => {
        expect(clampInt(0, 1, 10)).toBe(1);
        expect(clampInt(999, 1, 10)).toBe(10);
        expect(clampInt(-50, 1, 10)).toBe(1);
    });

    it('lo que no es un número devuelve null, NO cero', () => {
        // La diferencia importa y es la regla del campo vacío: cero es un VALOR
        // —«cero metros de bodega»— y null es «no se escribió». Si esto
        // devolviera 0, un campo en blanco se guardaría como un dato afirmado.
        expect(clampInt('', 1, 10)).toBeNull();
        expect(clampInt(null, 1, 10)).toBeNull();
        expect(clampInt(undefined, 1, 10)).toBeNull();
        expect(clampInt('abc', 1, 10)).toBeNull();
    });

    it('trunca el decimal en vez de redondear', () => {
        // `parseInt` corta: 5.9 es 5. Queda anclado porque si alguien lo
        // cambiara a `Math.round`, los valores del expediente se moverían solos
        // sin que nadie tocara el formulario.
        expect(clampInt('5.9', 1, 10)).toBe(5);
        expect(clampInt('5.1', 1, 10)).toBe(5);
    });

    it('lee el número que empieza la cadena', () => {
        // `parseInt('12abc')` es 12. No es lo ideal, pero es el comportamiento y
        // el formulario ya restringe la entrada; anclarlo evita que un cambio de
        // «limpieza» convierta un valor guardado en null.
        expect(clampInt('12abc', 1, 100)).toBe(12);
    });
});

describe('formatPhoneMask — el teléfono como se escribe en El Salvador', () => {
    it('parte ocho dígitos en dos bloques de cuatro', () => {
        expect(formatPhoneMask('23010013')).toBe('2301-0013');
        expect(formatPhoneMask('70123456')).toBe('7012-3456');
    });

    it('formatea mientras se escribe, sin guion de más', () => {
        // Un guion colgando («2301-») se ve como un error de la pantalla.
        expect(formatPhoneMask('2')).toBe('2');
        expect(formatPhoneMask('2301')).toBe('2301');
        expect(formatPhoneMask('23010')).toBe('2301-0');
    });

    it('descarta lo que no es dígito y recorta a ocho', () => {
        expect(formatPhoneMask('2301-0013')).toBe('2301-0013');
        expect(formatPhoneMask('(2301) 0013')).toBe('2301-0013');
        expect(formatPhoneMask('+503 2301 0013')).toBe('5032-3010');   // recorta a 8
        expect(formatPhoneMask('230100139999')).toBe('2301-0013');
    });

    it('vacío devuelve vacío, no "undefined"', () => {
        expect(formatPhoneMask('')).toBe('');
        expect(formatPhoneMask(null)).toBe('');
        expect(formatPhoneMask(undefined)).toBe('');
    });
});

describe('safeParse — el jsonb que puede llegar de dos formas', () => {
    it('parsea el texto y deja pasar el objeto', () => {
        expect(safeParse('{"a":1}')).toEqual({ a: 1 });
        expect(safeParse({ a: 1 })).toEqual({ a: 1 });
    });

    it('ante un texto roto devuelve un objeto vacío en vez de reventar', () => {
        // Falla ABIERTO a propósito: el expediente se abre igual, con los campos
        // en blanco. Lanzar dejaría la pantalla entera sin cargar por un solo
        // campo mal guardado.
        expect(safeParse('{roto')).toEqual({});
        expect(safeParse('no soy json')).toEqual({});
    });

    it('null y undefined dan objeto vacío', () => {
        expect(safeParse(null)).toEqual({});
        expect(safeParse(undefined)).toEqual({});
        expect(safeParse('')).toEqual({});
    });

    it('no confunde un cero ni un false con «vacío»', () => {
        // `obj || {}` convierte 0 y false en {} — cierto y anclado, porque el
        // día que alguien guarde un escalar acá esto lo va a comer en silencio.
        expect(safeParse(0)).toEqual({});
        expect(safeParse(false)).toEqual({});
    });
});
