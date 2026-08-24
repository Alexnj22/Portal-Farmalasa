// Buscar y exportar: dos mecánicas que atraviesan todo el portal.
//
// **La búsqueda** tiene que encontrar «GRAVOL 500MG X 8» escribiendo «grav 500»,
// y tiene que encontrar «CO-TRIMOXAZOL» escribiendo «cotrimoxazol»: los nombres
// del catálogo traen puntos, guiones y tildes que nadie va a teclear.
//
// **El archivo CSV** tiene tres bytes invisibles que son una DECISIÓN, no un
// default (`docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md` §9). Los libros
// de IVA se cotejan contra el archivo de referencia con un `diff`, y un diff que
// se ensucia con diferencias de codificación deja de servir para lo único que se
// le pide: mostrar diferencias de DATOS.
//
//   BOM `EF BB BF`   sin él, Excel en es-SV abre en Latin-1 y `PEÑA` sale `PEÃ‘A`
//   CRLF `0D 0A`     con LF a secas el diff marca TODAS las líneas como distintas
//   sin salto final  el archivo termina en el último dato

import { describe, it, expect } from 'vitest';
import { normSearch, tokenMatch, likePattern } from '../../src/utils/searchUtils';
import { buildCsvText } from '../../src/utils/csvExport';

describe('normalizar lo que se escribe y lo que se busca', () => {
    it('las tildes no cuentan', () => {
        expect(normSearch('Ácido')).toBe('acido');
        expect(normSearch('INYECCIÓN')).toBe('inyeccion');
    });

    it('los puntos y guiones del catálogo desaparecen', () => {
        // Nadie va a teclear «CO-TRIMOXAZOL» con el guión.
        expect(normSearch('S.S.N')).toBe('ssn');
        expect(normSearch('CO-TRIMOXAZOL')).toBe('cotrimoxazol');
        expect(normSearch("D'ANGELO, S.A.")).toBe('dangelo sa');
    });

    it('recorta los extremos y baja todo a minúsculas', () => {
        expect(normSearch('  GRAVOL  ')).toBe('gravol');
    });

    it('lo vacío no revienta — y `null` da la CADENA «null»', () => {
        expect(normSearch(undefined)).toBe('');    // el default de parámetro
        expect(normSearch('')).toBe('');
        // Se ancla como está: el default de parámetro sólo cubre `undefined`, y
        // `String(null)` es «null». No hace daño hoy porque quien busca escribe
        // en un input (nunca `null`) y `tokenMatch` ya pasa `f ?? ''` por cada
        // campo — pero si algún día se le pasa `null` directo, el término sería
        // la palabra «null» y encontraría cualquier fila que la contenga.
        expect(normSearch(null)).toBe('null');
    });
});

describe('buscar por palabras sueltas', () => {
    it('cada palabra tiene que estar, pero no en el mismo campo', () => {
        expect(tokenMatch('grav 500', 'GRAVOL 500MG X 8', 'Lab')).toBe(true);
        expect(tokenMatch('gravol lab', 'GRAVOL 500MG', 'Laboratorio X')).toBe(true);
    });

    it('el ORDEN no importa', () => {
        expect(tokenMatch('500 grav', 'GRAVOL 500MG X 8')).toBe(true);
    });

    it('si falta una palabra, no coincide', () => {
        expect(tokenMatch('grav 900', 'GRAVOL 500MG X 8')).toBe(false);
    });

    it('sin término, todo coincide — la lista no se vacía sola', () => {
        // Devolver `false` acá dejaría la pantalla en blanco al borrar el
        // buscador, que es justo cuando se quiere ver todo.
        expect(tokenMatch('', 'lo que sea')).toBe(true);
        expect(tokenMatch('   ', 'lo que sea')).toBe(true);
    });

    it('un campo ausente no rompe la búsqueda', () => {
        expect(tokenMatch('grav', 'GRAVOL', null, undefined)).toBe(true);
    });

    it('el término también se normaliza, no sólo el dato', () => {
        expect(tokenMatch('ÁCIDO', 'acido folico')).toBe(true);
        expect(tokenMatch('co-trimoxazol', 'COTRIMOXAZOL 800')).toBe(true);
    });
});

describe('el patrón para buscar en el servidor', () => {
    it('cada palabra se vuelve un tramo con comodines', () => {
        // «alcohol 90» tiene que encontrar «alcohol90», que es como quedó
        // normalizado en la columna.
        expect(likePattern('alcohol 90')).toBe('%alcohol%90%');
    });

    it('una sola palabra también va entre comodines', () => {
        expect(likePattern('gravol')).toBe('%gravol%');
    });

    it('sin término no filtra nada', () => {
        expect(likePattern('')).toBe('%');
        expect(likePattern()).toBe('%');
    });
});

describe('el archivo CSV', () => {
    const armar = (h, r) => buildCsvText(h, r);

    it('empieza con el BOM: sin él Excel en es-SV lee `PEÑA` como `PEÃ‘A`', () => {
        expect(armar(['a'], [['PEÑA']]).charCodeAt(0)).toBe(0xFEFF);
    });

    it('separa con punto y coma', () => {
        expect(armar(null, [['a', 'b', 'c']])).toBe('﻿a;b;c');
    });

    it('separa las filas con CRLF', () => {
        // Con LF a secas, el diff contra el archivo de referencia marca TODAS
        // las líneas como distintas y deja de servir.
        expect(armar(null, [['a'], ['b']])).toBe('﻿a\r\nb');
    });

    it('NO termina con un salto de línea', () => {
        // El reflejo natural —`map(l => l + '\r\n')`— agrega una línea vacía que
        // nadie ve en pantalla y que Excel lee como una fila más. En un libro
        // fiscal, una fila en blanco es una fila del libro.
        const texto = armar(['a'], [['1'], ['2']]);
        expect(texto.endsWith('\r\n')).toBe(false);
        expect(texto.split('\r\n')).toHaveLength(3);
    });

    it('sin encabezado el archivo arranca directo en datos', () => {
        // Los libros de IVA replican reportes que empiezan en la primera fila de
        // datos: una fila de rótulos los desalinea contra el archivo de
        // referencia.
        expect(armar(null, [['1', '2']])).toBe('﻿1;2');
        expect(armar(['A', 'B'], [['1', '2']])).toBe('﻿A;B\r\n1;2');
    });

    it('un valor con punto y coma se entrecomilla', () => {
        // Sin comillas, ese valor partiría la fila en dos columnas.
        expect(armar(null, [['PEREZ; ANA', 'x']])).toBe('﻿"PEREZ; ANA";x');
    });

    it('una comilla adentro se duplica', () => {
        expect(armar(null, [['dijo "hola"']])).toBe('﻿"dijo ""hola"""');
    });

    it('un salto de línea adentro también se entrecomilla', () => {
        expect(armar(null, [['dos\nlineas']])).toBe('﻿"dos\nlineas"');
    });

    it('null y undefined salen como celda vacía, no como «null»', () => {
        expect(armar(null, [[null, undefined, 0]])).toBe('﻿;;0');
    });

    it('un cero se escribe, no se cae', () => {
        // Es el caso que rompen los `value || ''`: en un libro, un 0 es un dato.
        expect(armar(null, [[0]])).toBe('﻿0');
    });
});
