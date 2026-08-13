import { describe, it, expect } from 'vitest';
import { parMinMaxValido, motivosQueExigenExplicacion } from '../../src/utils/minmaxSolicitud';

/**
 * Los MISMOS casos que se corrieron contra `minmax_change_requests` en
 * producción —dentro de una transacción con ROLLBACK— antes de aplicar
 * `mmcr_reason_required` (migración 20260813163152). Ahí dieron 11 de 11; acá
 * corren contra la mitad de la regla que vive en el navegador.
 *
 * Que la tabla sea idéntica es el punto: la pantalla y la base tienen que
 * aceptar y rechazar exactamente lo mismo, o el usuario se lleva un error
 * técnico de Postgres por algo que la pantalla le dejó escribir.
 */
const exige = (actual, min, max, reason) =>
    motivosQueExigenExplicacion(actual, min, max).length > 0 && !String(reason ?? '').trim();

const CASOS = [
    // rótulo                         actual              min  max  motivo            espera
    ['0/0 sin motivo',               { min: 16, max: 24 },  0,   0, null,             'rechaza'],
    ['0/0 con motivo',               { min: 16, max: 24 },  0,   0, 'sale del surtido', 'acepta'],
    ['0/0 motivo en blanco',         { min: 16, max: 24 },  0,   0, '   ',            'rechaza'],
    ['triplica MAX sin motivo',      { min: 16, max: 24 }, 20,  72, null,             'rechaza'],
    ['justo abajo de 3x',            { min: 16, max: 24 }, 20,  71, null,             'acepta'],
    ['triplica MIN sin motivo',      { min: 16, max: 24 }, 48,  96, null,             'rechaza'],
    ['estrena sobre 0/0',            { min: 0,  max: 0  },  2,   4, null,             'rechaza'],
    ['sin params hoy (null)',        null,                  1,   3, null,             'rechaza'],
    ['baja a la mitad',              { min: 16, max: 24 },  8,  12, null,             'acepta'],
    ['sube poco',                    { min: 16, max: 24 }, 20,  40, null,             'acepta'],
];

describe('motivosQueExigenExplicacion — igual que la guarda de la base', () => {
    it.each(CASOS)('%s', (_rotulo, actual, min, max, reason, espera) => {
        expect(exige(actual, min, max, reason) ? 'rechaza' : 'acepta').toBe(espera);
    });

    it('el 0 · 0 dice que el producto deja de reponerse', () => {
        expect(motivosQueExigenExplicacion({ min: 16, max: 24 }, 0, 0))
            .toEqual(['Se deja en cero: el producto deja de reponerse.']);
    });

    it('nombra el lado y el múltiplo, para que el pedido no parezca un capricho', () => {
        expect(motivosQueExigenExplicacion({ min: 16, max: 24 }, 20, 72))
            .toEqual(['El MAX propuesto (72) es 3× el de hoy (24).']);
    });

    it('un par imposible no exige motivo: primero falla el par', () => {
        expect(motivosQueExigenExplicacion({ min: 16, max: 24 }, 0, 2)).toEqual([]);
        expect(motivosQueExigenExplicacion({ min: 16, max: 24 }, null, 5)).toEqual([]);
    });
});

describe('parMinMaxValido — copia de mmcr_pair_valid', () => {
    it('acepta el retiro y el «traelo sólo si lo piden»', () => {
        expect(parMinMaxValido(0, 0)).toBe(true);   // el que la pantalla bloqueaba
        expect(parMinMaxValido(0, 1)).toBe(true);
    });
    it('con MIN en 0 el MAX no pasa de 1', () => {
        expect(parMinMaxValido(0, 2)).toBe(false);
    });
    it('con MIN de 1 para arriba, el MAX lo tiene que superar', () => {
        expect(parMinMaxValido(2, 4)).toBe(true);
        expect(parMinMaxValido(2, 2)).toBe(false);
        expect(parMinMaxValido(2, 1)).toBe(false);
    });
    it('vacío o no numérico no es un par', () => {
        expect(parMinMaxValido(null, 4)).toBe(false);
        expect(parMinMaxValido(1, null)).toBe(false);
        expect(parMinMaxValido(Number.NaN, 4)).toBe(false);
    });
});
