// Los campos de texto que comparten los documentos que salen por el rollo.
//
// El papel es donde nadie mira dos veces: si un nombre sale con basura o
// cortado a mitad de palabra, el ticket ya está impreso y firmado. Y estas
// reglas viven acá justamente porque estaban a punto de existir DOS veces —una
// por documento— y dos definiciones de «sólo ASCII» se rompen la misma noche.
//
// La receta completa, campo por campo, en la §5 de
// `docs/IMPRESION-EN-TICKETERA-2026-08-13.md`.

import { describe, it, expect } from 'vitest';
import { COLUMNAS, soloAscii, recortar, fechaCorta, hhmm, selloDeTiempo, selloCorto, juntarSiEntra }
    from '../../src/utils/ticketCampos';

describe('el rollo es ASCII y nada más', () => {
    it('la eñe se vuelve n, no basura', () => {
        // «NUÑEZ» salió `NUÆEZ` la primera vez que se imprimió de verdad. Los
        // nombres vienen de la base y nadie los escribió pensando en papel
        // térmico.
        expect(soloAscii('NUÑEZ')).toBe('NUNEZ');
        expect(soloAscii('Muñoz')).toBe('Munoz');
    });

    it('las tildes se caen y la letra queda', () => {
        expect(soloAscii('José Peña Ávila')).toBe('Jose Pena Avila');
    });

    it('lo que no es ASCII imprimible desaparece', () => {
        expect(soloAscii('total → $5')).toBe('total  $5');
        expect(soloAscii('a\u0007b')).toBe('ab');          // un carácter de control
        expect(soloAscii('12\u00a034')).toBe('1234');      // espacio duro
    });

    it('deja intacto lo que ya era ASCII', () => {
        expect(soloAscii('SALUD 4 - CORTE Z #1024')).toBe('SALUD 4 - CORTE Z #1024');
    });

    it('lo vacío no revienta', () => {
        for (const v of [null, undefined, '']) expect(soloAscii(v)).toBe('');
    });
});

describe('recortar lo hace el portal, no la impresora', () => {
    it('un texto que entra sale igual', () => {
        expect(recortar('Ana Pena', 20)).toBe('Ana Pena');
    });

    it('uno que no entra termina en punto, y NO excede el ancho', () => {
        // La impresora parte donde se le acaba el rollo, a mitad de palabra.
        const r = recortar('Maria Fernanda de los Angeles Rodriguez', 20);
        expect(r).toHaveLength(20);
        expect(r.endsWith('.')).toBe(true);
    });

    it('recorta DESPUÉS de limpiar, no antes', () => {
        // Si midiera el original, una tilde contaría un carácter que no va a
        // salir y el recorte quedaría corto.
        expect(recortar('  Ángel  ', 10)).toBe('Angel');
    });

    it('el ancho del rollo en letra chica son 54 columnas', () => {
        expect(COLUMNAS).toBe(54);
    });
});

describe('las fechas y las horas', () => {
    it('una fecha `YYYY-MM-DD` no la corre el huso', () => {
        // Pasarla por `new Date()` la leería como UTC y en El Salvador
        // retrocedería un día: el ticket diría el día anterior.
        expect(fechaCorta('2026-08-24')).toBe('24/08/2026');
        expect(fechaCorta('2026-01-01')).toBe('01/01/2026');
    });

    it('sin fecha no imprime «undefined»', () => {
        for (const v of [null, undefined, '']) expect(fechaCorta(v)).toBe('');
    });

    it('la hora del corte va sin segundos', () => {
        expect(hhmm('19:01:41')).toBe('19:01');
        expect(hhmm('07:00:00')).toBe('07:00');
        expect(hhmm(null)).toBe('');
    });
});

describe('el sello de tiempo', () => {
    const iso = '2026-08-15T01:12:00Z';   // 14-ago 19:12 en El Salvador

    it('se escribe en hora de la sala, no en la de quien imprime', () => {
        expect(selloDeTiempo(iso)).toContain('14/08/2026');
        expect(selloDeTiempo(iso)).toMatch(/07:12/);
    });

    it('sale en ASCII', () => {
        expect(selloDeTiempo(iso)).toMatch(/^[\x20-\x7E]*$/);
    });

    it('el corto entra en media columna del rollo', () => {
        // `selloDeTiempo` mide 23 y media columna son 27: con el rótulo delante
        // no entra ni uno, y un ticket lleno de sellos largos sale al doble de
        // largo porque no puede armar dos columnas.
        const corto = selloCorto(iso);
        expect(corto.length).toBeLessThanOrEqual(Math.floor(COLUMNAS / 2));
        expect(corto.length).toBeLessThan(selloDeTiempo(iso).length);
    });

    it('el corto suelta el siglo, la coma y los puntos de p.m.', () => {
        expect(selloCorto(iso)).toBe('14/08/26 07:12 pm');
    });

    it('sin instante, los dos quedan vacíos', () => {
        expect(selloDeTiempo(null)).toBe('');
        expect(selloCorto(undefined)).toBe('');
    });
});

describe('juntar dos textos en un renglón sólo si entran', () => {
    it('los junta cuando caben', () => {
        expect(juntarSiEntra('Registro: Ana Pena', '14/08/26 07:12 pm'))
            .toEqual(['Registro: Ana Pena - 14/08/26 07:12 pm']);
    });

    it('los deja en dos renglones cuando no', () => {
        // Un nombre de 40 caracteres desborda las 54 columnas y la impresora lo
        // parte a mitad de palabra.
        const largo = 'Registro: Maria Fernanda de los Angeles Rodriguez';
        expect(juntarSiEntra(largo, '14/08/26 07:12 pm')).toEqual([largo, '14/08/26 07:12 pm']);
    });

    it('el borde exacto entra', () => {
        const a = 'x'.repeat(COLUMNAS - 3 - 1), b = 'y';
        expect(juntarSiEntra(a, b)).toHaveLength(1);
        expect(juntarSiEntra(a + 'x', b)).toHaveLength(2);
    });

    it('con uno solo devuelve ese, y con ninguno un arreglo vacío', () => {
        // Devuelve arreglo siempre para poder esparcirlo en el pie sin un `if`
        // en cada uso.
        expect(juntarSiEntra('solo', null)).toEqual(['solo']);
        expect(juntarSiEntra(null, 'solo')).toEqual(['solo']);
        expect(juntarSiEntra(null, null)).toEqual([]);
        expect(juntarSiEntra('', '')).toEqual([]);
    });
});
