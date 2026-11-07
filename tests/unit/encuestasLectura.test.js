import { describe, it, expect } from 'vitest';
import { crucesNotables, dimensionesCruzables, estadoDeLectura, paqueteParaSaly } from '@nucleo/utils/encuestasLectura';

const cuestionario = { secciones: [{ id: 's1', preguntas: [
    { id: 'motivo', tipo: 'unica', texto: '¿Por qué nos elige?', opciones: [{ id: 'precio', texto: 'Precio' }, { id: 'atencion', texto: 'Atención' }] },
    { id: 'app', tipo: 'si_no', texto: '¿Conoce la app?' },
    { id: 'nps', tipo: 'nps', texto: '¿Nos recomendaría?' },
    { id: 'medios', tipo: 'multiple', texto: 'Medios', opciones: [{ id: 'fb', texto: 'Facebook' }, { id: 'tv', texto: 'TV' }] },
    { id: 'coment', tipo: 'texto', texto: 'Comentarios' },
] }] };

// 10 eligen por precio y casi ninguno conoce la app; 10 por atención y casi todos la conocen.
const filas = [
    ...Array.from({ length: 10 }, (_, i) => ({ sucursal: 'Salud 1', canal: 'entrevista', respuestas: { motivo: 'precio', app: i < 2, nps: 5 + (i % 3), medios: ['fb'] } })),
    ...Array.from({ length: 10 }, (_, i) => ({ sucursal: 'Salud 2', canal: 'entrevista', respuestas: { motivo: 'atencion', app: i < 9, nps: 9 + (i % 2), medios: ['fb', 'tv'] } })),
];

describe('dimensionesCruzables', () => {
    it('agrupa el NPS y deja fuera las abiertas', () => {
        const dims = dimensionesCruzables(cuestionario);
        expect(dims.map((d) => d.id)).toEqual(['motivo', 'app', 'nps', 'medios']);
        const nps = dims.find((d) => d.id === 'nps');
        expect(nps.de(10)).toEqual(['Promotor (9-10)']);
        expect(nps.de(7)).toEqual(['Pasivo (7-8)']);
        expect(nps.de(0)).toEqual(['Detractor (0-6)']);
        expect(nps.de(null)).toEqual([]);
        expect(dims.find((d) => d.id === 'medios').de(['fb', 'tv'])).toEqual(['Facebook', 'TV']);
        expect(dims.find((d) => d.id === 'app').de(false)).toEqual(['No']);
    });
});

describe('crucesNotables', () => {
    it('encuentra que quienes eligen por precio no conocen la app, con números exactos', () => {
        const cruces = crucesNotables(cuestionario, filas);
        const precioApp = cruces.find((c) => c.grupo.includes('«Precio»') && c.enGrupo.includes('¿Conoce la app?'));
        expect(precioApp).toBeTruthy();
        // 2 de 10 la conocen (20 %) contra 11 de 20 (55 %) en general → «Sí» −35, o «No» +35.
        expect([precioApp.pctGrupo, precioApp.pctTotal]).toEqual(precioApp.enGrupo.includes('«Sí»') ? [20, 55] : [80, 45]);
        expect(precioApp.n).toBe(10);
    });

    it('no repite el mismo cruce en las dos direcciones', () => {
        const pares = crucesNotables(cuestionario, filas, { max: 100 }).map((c) => [c.grupo, c.enGrupo].sort().join('|'));
        expect(new Set(pares).size).toBe(pares.length);
    });

    it('ignora grupos chicos', () => {
        expect(crucesNotables(cuestionario, filas.slice(0, 4))).toEqual([]);
    });

    it('sin diferencias no inventa nada', () => {
        const iguales = Array.from({ length: 20 }, (_, i) => ({ respuestas: { motivo: i % 2 ? 'precio' : 'atencion', app: i % 4 < 2 } }));
        expect(crucesNotables(cuestionario, iguales)).toEqual([]);
    });
});

describe('paqueteParaSaly', () => {
    it('lleva distribuciones contadas, cruces por sucursal y comentarios sin contacto', () => {
        const p = paqueteParaSaly({
            encuesta: { nombre: 'Satisfacción', cuestionario },
            datos: { total: 20, por_canal: { entrevista: 20 }, nps: { respuestas: 20, puntaje: 20, promotores: 10, pasivos: 3, detractores: 7 },
                por_pregunta: [], por_dimension: [], por_sucursal: [{ nombre: 'Salud 1', respuestas: 10, nps: -70 }] },
            filas,
            comentarios: [{ sucursal: 'Salud 1', nps: 5, texto: 'Muy caro', telefono: '7777-7777', contacto_nombre: 'Ana' }],
        });
        expect(p.preguntas.map((q) => q.n)).toEqual([1, 2, 3, 4]);
        expect(p.preguntas[0].distribucion).toEqual(['Precio: 10 (50 %)', 'Atención: 10 (50 %)']);
        expect(p.preguntas[3].distribucion[0]).toBe('Facebook: 20 (100 %)');
        expect(p.cruces.some((t) => t.includes('Sucursal'))).toBe(true);
        expect(JSON.stringify(p.comentarios)).not.toMatch(/7777|Ana/);
    });
});

describe('estadoDeLectura', () => {
    it('sin respuestas no se puede pedir', () => {
        expect(estadoDeLectura({ respuestas: 0, nuevas: 0 }).puede).toBe(false);
    });
    it('sin lectura y con respuestas, sí', () => {
        expect(estadoDeLectura({ respuestas: 3, nuevas: 3, minimo_nuevas: 5 })).toMatchObject({ puede: true, hay: false });
    });
    it('con lectura, espera las nuevas mínimas', () => {
        const e = estadoDeLectura({ texto: 'x', respuestas: 23, nuevas: 3, minimo_nuevas: 5 });
        expect(e.puede).toBe(false);
        expect(e.ayuda).toMatch(/5 respuestas nuevas \(van 3\)/);
    });
});
