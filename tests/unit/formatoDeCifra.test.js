// El formato canónico de toda cifra que ve el usuario.
//
// Existe porque no existía: al medirlo el 2026-07-29 el portal tenía **50
// `toFixed(2)`, 15 combinaciones distintas de opciones `Intl` y CUATRO locales**
// en uso — y las locales no son intercambiables. `es` y `es-ES` usan coma
// decimal y sin separador de miles; `es-VE` usa punto de miles. Entonces el
// mismo monto se veía `$1,234.56` en una pantalla, `$1234,56` en el tablero y
// `$1.234,56` en Mis Avisos.
//
// Estas pruebas anclan las dos decisiones que ese arreglo tomó, porque las dos
// se pueden deshacer sin que nada falle:
//
//   1. **el locale es FIJO `es-SV`**, no se hereda del navegador — un navegador
//      configurado en España no debería cambiarle los separadores al portal de
//      El Salvador;
//   2. **el nulo es `—`, nunca `$NaN`** — antes cada sitio lo resolvía a su
//      manera y había `$NaN` alcanzable en pantalla.

import { describe, it, expect } from 'vitest';
import { formatMoney, formatQty, formatMoneyCorto, formatPct } from '../../src/utils/formatNumber';

describe('dinero', () => {
    it.each([
        [1234.5,  {},                  '$1,234.50'],
        [1234.5,  { decimales: 0 },    '$1,235'],
        [0,       {},                  '$0.00'],
        [1234.5,  { signo: false },    '1,234.50'],
        [1_234_567.891, {},            '$1,234,567.89'],
    ])('formatMoney(%s, %o) → %s', (v, o, esperado) => {
        expect(formatMoney(v, o)).toBe(esperado);
    });

    it('el menos va ANTES del signo de peso', () => {
        // `-$89.90`, no `$-89.90`: es como lo escribe la convención local y como
        // lo lee un contador. Un negativo mal puesto en una columna de dinero se
        // lee como positivo de un vistazo.
        expect(formatMoney(-89.9)).toBe('-$89.90');
        expect(formatMoney(-89.9, { signo: false })).toBe('-89.90');
    });

    it('separador de miles con punto decimal — la convención de El Salvador', () => {
        // Si alguien cambiara el locale a `es` o `es-ES` esto saldría
        // `1234,56` y la prueba lo caza. Es la regresión que importa.
        expect(formatMoney(1234.56)).toBe('$1,234.56');
        expect(formatMoney(1234.56)).not.toContain('1.234');
    });
});

describe('lo que no es un número se muestra como vacío, nunca como NaN', () => {
    it.each([null, undefined, '', 'abc', NaN, Infinity, -Infinity])('formatMoney(%s) → «—»', (v) => {
        expect(formatMoney(v)).toBe('—');
    });

    it('las cuatro funciones comparten ese vacío', () => {
        expect([formatMoney(null), formatQty(null), formatMoneyCorto(null), formatPct(null)])
            .toEqual(['—', '—', '—', '—']);
    });

    it('el placeholder se puede cambiar por sitio', () => {
        expect(formatMoney(null, { vacio: 'sin dato' })).toBe('sin dato');
    });

    it('el CERO no es vacío', () => {
        // `0` es falsy en JavaScript, así que un `valor || '—'` escrito a mano lo
        // convertiría en «—» y una caja cuadrada en cero se leería como una caja
        // sin datos. Son cosas distintas.
        expect(formatMoney(0)).toBe('$0.00');
        expect(formatQty(0)).toBe('0');
        expect(formatPct(0)).toBe('0.0%');
    });

    it('una cadena numérica sí se acepta', () => {
        // Los montos llegan como `text` desde PostgREST cuando son `numeric`.
        expect(formatMoney('1234.5')).toBe('$1,234.50');
        expect(formatQty('18364')).toBe('18,364');
    });
});

describe('cantidades', () => {
    it('por defecto sin decimales: casi todo lo que se cuenta son unidades enteras', () => {
        expect(formatQty(18364)).toBe('18,364');
        expect(formatQty(2.5)).toBe('3');            // redondea
    });

    it('`decimales` fuerza; `decimalesMax` recorta los ceros de la derecha', () => {
        // La diferencia importa: una columna de cantidades con factor de
        // presentación se llenaría de `.00` inútiles con el modo forzado.
        expect(formatQty(2.5,  { decimales: 2 })).toBe('2.50');
        expect(formatQty(2.5,  { decimalesMax: 2 })).toBe('2.5');
        expect(formatQty(2,    { decimalesMax: 2 })).toBe('2');
    });
});

describe('monto abreviado — la escalera completa', () => {
    // Existía DOS veces y distinto: a la copia de «Sin Venta» le faltaba el
    // peldaño de los miles, así que $5,400 salía `$5.4k` en Mín·Máx y
    // `$5,400.00` en Sin Venta. Cada peldaño queda anclado.
    it.each([
        [1_250_000, '$1.25M'],
        [450_000,   '$450k'],
        [5_400,     '$5.4k'],
        [89.9,      '$89.90'],
        [-5_400,    '-$5.4k'],
    ])('formatMoneyCorto(%s) → %s', (v, esperado) => {
        expect(formatMoneyCorto(v)).toBe(esperado);
    });

    it('los bordes de cada peldaño', () => {
        expect(formatMoneyCorto(999.99)).toBe('$999.99');   // todavía completo
        expect(formatMoneyCorto(1_000)).toBe('$1k');        // entra a miles
        expect(formatMoneyCorto(99_999)).toBe('$100k');     // 1 decimal redondea
        expect(formatMoneyCorto(100_000)).toBe('$100k');    // entra al peldaño sin decimales
        expect(formatMoneyCorto(999_999)).toBe('$1,000k');
        expect(formatMoneyCorto(1_000_000)).toBe('$1M');
    });
});

describe('porcentaje', () => {
    it('recibe el número tal como se muestra, no la fracción', () => {
        // `formatPct(12.34)` es 12.3%, no 1234%. Confundirlo es el error clásico
        // y da un número cien veces más grande sin que nada falle.
        expect(formatPct(12.34)).toBe('12.3%');
        expect(formatPct(0.1234)).toBe('0.1%');
    });

    it('acepta más decimales cuando el dato los tiene', () => {
        expect(formatPct(12.345, { decimales: 2 })).toBe('12.35%');
        expect(formatPct(100)).toBe('100.0%');
    });
});
