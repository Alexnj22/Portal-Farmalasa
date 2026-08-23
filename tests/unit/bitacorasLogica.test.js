// Bitácoras — el día de El Salvador y el folio, que son un registro legal.
//
// El área no tenía ni una prueba. Y lo que hay acá adentro es de las dos clases
// que más caro salen en este repo:
//
//   · FECHAS. Todo el módulo cuenta en el DÍA DE NEGOCIO de El Salvador
//     (UTC−6), no en el del navegador. Un día corrido no da error: escribe la
//     lectura de temperatura en la fecha equivocada, y el libro que se le
//     presenta al Consejo queda con un renglón fuera de lugar.
//   · FOLIOS. Es el número con el que una dispensación bajo receta se busca en
//     papel. Si el rótulo cambia de forma o el parseo deja de aceptar lo que la
//     gente escribe, «no existe» y «lo escribiste distinto» se ven igual en
//     pantalla.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    hoySV, periodoDe, correrDia, correrPeriodo,
    partirFolio, rotularFolio, faltantesDelRenglon, soloLimpieza,
} from '../../src/data/bitacoras';

afterEach(() => vi.useRealTimers());

// Congela el reloj en un instante UTC concreto para poder afirmar sobre el día
// salvadoreño sin depender de dónde corre la prueba.
const enUTC = (iso) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };

describe('el día de negocio es el de El Salvador, no el del navegador', () => {
    it('a las 23:00 de El Salvador todavía es el mismo día', () => {
        // 2026-08-23 23:00 SV = 2026-08-24 05:00 UTC. Con la fecha UTC el portal
        // ya estaría en el 24 y la lectura de las 11 de la noche caería en el
        // día siguiente.
        enUTC('2026-08-24T05:00:00Z');
        expect(hoySV()).toBe('2026-08-23');
    });

    it('a las 00:30 de El Salvador ya es el día nuevo', () => {
        enUTC('2026-08-24T06:30:00Z');
        expect(hoySV()).toBe('2026-08-24');
    });

    it('el borde exacto de medianoche salvadoreña cambia de día', () => {
        enUTC('2026-08-24T05:59:59Z');   // 23:59:59 SV del 23
        expect(hoySV()).toBe('2026-08-23');
        enUTC('2026-08-24T06:00:00Z');   // 00:00:00 SV del 24
        expect(hoySV()).toBe('2026-08-24');
    });
});

describe('correr días y meses sin que el huso los mueva', () => {
    it('suma y resta días', () => {
        expect(correrDia('2026-08-23', 1)).toBe('2026-08-24');
        expect(correrDia('2026-08-23', -1)).toBe('2026-08-22');
        expect(correrDia('2026-08-23', 0)).toBe('2026-08-23');
    });

    it('cruza fin de mes, fin de año y el 29 de febrero', () => {
        expect(correrDia('2026-08-31', 1)).toBe('2026-09-01');
        expect(correrDia('2026-12-31', 1)).toBe('2027-01-01');
        expect(correrDia('2027-01-01', -1)).toBe('2026-12-31');
        // 2028 es bisiesto: el 28 de febrero + 1 es el 29, no el 1 de marzo.
        expect(correrDia('2028-02-28', 1)).toBe('2028-02-29');
        expect(correrDia('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('no se corre por el huso de quien corre la prueba', () => {
        // La función ancla en T12:00:00Z justamente para esto: a mediodía UTC
        // ningún huso del mundo cambia la fecha. Si alguien la simplificara a
        // `new Date(fecha)`, en El Salvador el resultado retrocedería un día.
        for (const f of ['2026-01-01', '2026-06-15', '2026-12-31']) {
            expect(correrDia(f, 0)).toBe(f);
        }
    });

    it('corre períodos YYYY-MM', () => {
        expect(correrPeriodo('2026-08', 1)).toBe('2026-09');
        expect(correrPeriodo('2026-12', 1)).toBe('2027-01');
        expect(correrPeriodo('2026-01', -1)).toBe('2025-12');
        expect(correrPeriodo('2026-08', -12)).toBe('2025-08');
    });

    it('el período de una fecha es su año y mes', () => {
        expect(periodoDe('2026-08-23')).toBe('2026-08');
        expect(periodoDe('2026-12-31')).toBe('2026-12');
    });
});

describe('el folio — lo que la gente escribe y lo que el libro muestra', () => {
    it('acepta las tres formas en que alguien lo escribe', () => {
        expect(partirFolio('2026-00007', 2026)).toEqual({ anio: 2026, folio: 7 });
        expect(partirFolio('2026-7', 2026)).toEqual({ anio: 2026, folio: 7 });
        expect(partirFolio('7', 2026)).toEqual({ anio: 2026, folio: 7 });
    });

    it('sin año escrito usa el que se le pasa, no el del reloj', () => {
        // Importa: quien busca en enero un folio del año pasado escribe el
        // número a secas. Que el año por defecto sea un parámetro y no
        // `new Date()` adentro es lo que deja resolverlo desde afuera.
        expect(partirFolio('42', 2025)).toEqual({ anio: 2025, folio: 42 });
    });

    it('tolera espacios y la barra, que es como se escribe en papel', () => {
        expect(partirFolio('  2026 - 7  ', 2026)).toEqual({ anio: 2026, folio: 7 });
        expect(partirFolio('2026/7', 2026)).toEqual({ anio: 2026, folio: 7 });
    });

    it('devuelve null ante lo que no es un folio, en vez de inventar uno', () => {
        // `null` y «folio 0» tienen que ser distinguibles: uno es «no se
        // entiende lo que escribiste» y el otro sería una búsqueda real.
        expect(partirFolio('')).toBeNull();
        expect(partirFolio(null)).toBeNull();
        expect(partirFolio('abc')).toBeNull();
        expect(partirFolio('2026-')).toBeNull();
        expect(partirFolio('20-7')).toBeNull();          // año de dos dígitos: no
        expect(partirFolio('2026-1234567')).toBeNull();  // más de 6 cifras: no
    });

    it('el rótulo lleva cinco cifras, siempre', () => {
        expect(rotularFolio(2026, 7)).toBe('2026-00007');
        expect(rotularFolio(2026, 12345)).toBe('2026-12345');
        // Y sobre un folio ya largo NO recorta: perder una cifra del número de
        // un libro legal es peor que romper la alineación de la columna.
        expect(rotularFolio(2026, 123456)).toBe('2026-123456');
    });

    it('rotular y volver a partir devuelve lo mismo', () => {
        for (const n of [1, 7, 99, 12345]) {
            expect(partirFolio(rotularFolio(2026, n), 2026)).toEqual({ anio: 2026, folio: n });
        }
    });
});

describe('qué le falta a un renglón de dispensación', () => {
    it('pide paciente, médico y foto de la receta', () => {
        expect(faltantesDelRenglon({})).toEqual(['paciente', 'médico', 'foto de la receta']);
        expect(faltantesDelRenglon({ paciente: 'Ana', medico: 'Dr. X', tiene_foto: true })).toEqual([]);
    });

    it('una receta anulada no le falta nada', () => {
        // Sin esto, una anulada quedaría para siempre en la lista de pendientes
        // — es la misma familia del aviso de «sin enviar» que no se apagaba.
        expect(faltantesDelRenglon({ estado: 'anulada' })).toEqual([]);
    });

    it('un renglón que no existe no rompe la lista', () => {
        expect(faltantesDelRenglon(null)).toEqual([]);
        expect(faltantesDelRenglon(undefined)).toEqual([]);
    });
});

describe('un área sin franjas es sólo de limpieza', () => {
    it('distingue el área con franjas de la que no las tiene', () => {
        expect(soloLimpieza({ franjas: [] })).toBe(true);
        expect(soloLimpieza({})).toBe(true);
        expect(soloLimpieza(null)).toBe(true);
        expect(soloLimpieza({ franjas: [{ id: 1 }] })).toBe(false);
    });
});
