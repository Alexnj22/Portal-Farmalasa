// ─────────────────────────────────────────────────────────────────────────────
// Un documento que nombra a varias personas
// ─────────────────────────────────────────────────────────────────────────────
//
// El acuse del Ministerio por una recontratación no es un papel por persona: el
// Ministerio devuelve UNO con la lista de todos. Para poder repartirlo hay que
// cruzar el nombre leído del papel contra el de cada ficha, y eso se decide en
// DOS lugares: acá (el navegador, que muestra quién tiene ficha y quién no) y en
// `public.nombre_normalizado` (la base, que guarda el pendiente por nombre y lo
// aplica cuando la ficha nace).
//
// ⚠️ SON GEMELOS. Si uno cambia y el otro no, el circuito se parte en silencio:
// el navegador diría «ya tiene ficha» y la base guardaría el pendiente igual —o
// al revés, y el documento nunca llegaría—. Es exactamente lo que enseñó
// `turno_del_dia`, y por eso las dos se enfrentan sobre los mismos casos.
//
// La columna «base» de la tabla de abajo NO está escrita a mano: se midió
// ejecutando `public.nombre_normalizado` contra producción el 2026-08-28. Al
// cambiar cualquiera de las dos, hay que volver a medirla.

import { describe, it, expect } from 'vitest';
import { normalizarNombre, cruzarConElPadron } from '../../src/data/documentosCompartidos';

// [ lo que entra , lo que devolvió la BASE ]
const MEDIDO_EN_LA_BASE = [
    ['José  Luis  Ñúñez-Pérez.',    'JOSE LUIS NUNEZ PEREZ'],
    ['JOSE LUIS NUNEZ PEREZ',       'JOSE LUIS NUNEZ PEREZ'],
    ['  maría   josé  del carmen  ', 'MARIA JOSE DEL CARMEN'],
    ["O'Brien, Ana",                'O BRIEN ANA'],
    ['Jesús Ángel Mejía 3ro',       'JESUS ANGEL MEJIA RO'],
    ['ÜBER ÑOÑO',                   'UBER NONO'],
    ['',                            ''],
    ['   ',                         ''],
    ['Ana-María  de  la  Cruz',     'ANA MARIA DE LA CRUZ'],
    ['Pedro  Pérez   Jr.',          'PEDRO PEREZ JR'],
    ['ANA  MARIA DE LA CRUZ',       'ANA MARIA DE LA CRUZ'],
    ['Élver Gálvez',                'ELVER GALVEZ'],
    ['x',                           'X'],
    ['123 456',                     ''],
    ['Sofía Núñez  (regente)',      'SOFIA NUNEZ REGENTE'],
];

describe('el nombre normalizado: el navegador y la base dicen lo mismo', () => {
    it.each(MEDIDO_EN_LA_BASE)('«%s»', (entrada, enLaBase) => {
        expect(normalizarNombre(entrada)).toBe(enLaBase);
    });

    // Los dos casos que hacen falta para que esto sirva de algo: el mismo nombre
    // escrito de dos maneras tiene que cruzar, y dos personas distintas no.
    it('el mismo nombre escrito distinto cruza', () => {
        expect(normalizarNombre('José  Luis  Ñúñez-Pérez.'))
            .toBe(normalizarNombre('JOSE LUIS NUNEZ PEREZ'));
    });
    it('dos personas distintas no cruzan', () => {
        expect(normalizarNombre('Ana Vásquez')).not.toBe(normalizarNombre('Ana Vázquez'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El cruce contra el padrón
// ─────────────────────────────────────────────────────────────────────────────

const PADRON = [
    { id: 'a', name: 'JOSE LUIS NUNEZ PEREZ', first_names: 'José Luis', last_names: 'Ñúñez Pérez' },
    { id: 'b', name: 'ANA MARIA DE LA CRUZ',  first_names: 'Ana María', last_names: 'de la Cruz' },
];

describe('cruzar lo leído con el padrón', () => {
    it('encuentra a quien ya tiene ficha, con el nombre escrito distinto', () => {
        const r = cruzarConElPadron(['José  Luis  Ñúñez-Pérez'], PADRON);
        expect(r).toHaveLength(1);
        expect(r[0].empleado?.id).toBe('a');
    });

    it('a quien no tiene ficha lo devuelve sin ella, no lo descarta', () => {
        // Descartarlo sería perder justo la mitad que el usuario pidió: «al
        // crearlos lo asigne de un solo».
        const r = cruzarConElPadron(['Persona Nueva'], PADRON);
        expect(r).toHaveLength(1);
        expect(r[0].empleado).toBeNull();
    });

    it('el mismo nombre repetido en el papel se cuenta una vez', () => {
        const r = cruzarConElPadron(['Ana María de la Cruz', 'ANA MARIA DE LA CRUZ'], PADRON);
        expect(r).toHaveLength(1);
    });

    it('marca la ficha que se está editando, en vez de proponerla', () => {
        const r = cruzarConElPadron(['José Luis Ñúñez Pérez'], PADRON, 'a');
        expect(r[0].esLaAbierta).toBe(true);
    });

    it('un nombre vacío o sin letras no produce una fila', () => {
        expect(cruzarConElPadron(['', '   ', '123'], PADRON)).toHaveLength(0);
    });

    // Dos fichas que se llaman igual no las distingue un nombre: se avisa en vez
    // de elegir una. Elegir sería escribir el documento en el expediente de
    // alguien por orden de carga.
    it('avisa cuando dos fichas normalizan al mismo nombre', () => {
        const conGemela = [...PADRON, { id: 'c', name: 'Jose Luis Nunez Perez', first_names: 'Jose Luis', last_names: 'Nunez Perez' }];
        const r = cruzarConElPadron(['José Luis Ñúñez Pérez'], conGemela);
        expect(r[0].ambiguo).toBe(true);
    });
});
