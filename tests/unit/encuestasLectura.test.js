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

describe('bloquesDeLectura', () => {
    it('separa títulos, texto y puntos como los escribe Saly', async () => {
        const { bloquesDeLectura } = await import('@nucleo/utils/encuestasLectura');
        const texto = `**En pocas palabras:**
Son resultados preliminares.
Indican algo.

**Lo que muestran los números:**
* Me preocupa que el 100 % (2 de 2) no usa la app.
* Hay **desconexión** en medios.

**Qué haría:**
1. Comunicar la privacidad.
2. Reforzar Instagram.`;
        const b = bloquesDeLectura(texto);
        expect(b.map((x) => x.clave)).toEqual(['resumen', 'numeros', 'acciones']);
        expect(b[0].texto).toBe('Son resultados preliminares. Indican algo.');
        expect(b[1].puntos).toEqual(['Me preocupa que el 100 % (2 de 2) no usa la app.', 'Hay desconexión en medios.']);
        expect(b[2].puntos).toHaveLength(2);
    });
    it('título y texto en la misma línea, y texto sin títulos', async () => {
        const { bloquesDeLectura } = await import('@nucleo/utils/encuestasLectura');
        expect(bloquesDeLectura('**En pocas palabras:** Todo bien.')[0]).toMatchObject({ clave: 'resumen', texto: 'Todo bien.' });
        expect(bloquesDeLectura('Sólo texto.')[0]).toMatchObject({ titulo: null, texto: 'Sólo texto.' });
    });
});

describe('invitacionDeSaly', () => {
    it('invita, ofrece releer y calla sin respuestas', async () => {
        const { invitacionDeSaly } = await import('@nucleo/utils/encuestasLectura');
        expect(invitacionDeSaly({ respuestas: 0 })).toBeNull();
        expect(invitacionDeSaly({ respuestas: 4, nuevas: 4 }, { varias: true })).toMatch(/todas las sucursales o de una/);
        expect(invitacionDeSaly({ texto: 'x', respuestas: 12, nuevas: 6, minimo_nuevas: 5 })).toMatch(/6 respuestas nuevas/);
    });
});

describe('avisoDeLectura', () => {
    const lugares = [{ value: null, label: 'Todas las sucursales', respuestas: 9 }, { value: 3, label: 'Salud 2', respuestas: 4 }];
    it('con varios lugares pregunta cuál, y cada botón lee ese', async () => {
        const { avisoDeLectura } = await import('@nucleo/utils/encuestasLectura');
        const pedidos = [];
        const a = avisoDeLectura({ lectura: { respuestas: 9, nuevas: 9 }, lugares, onLeer: (b) => pedidos.push(b) });
        expect(a.boton).toBe('Elegir qué leo');
        const botones = a.explicacion.find((p) => p.tipo === 'botones').items;
        botones.forEach((b) => b.hacer());
        expect(pedidos).toEqual([null, 3]);
    });
    it('con un solo lugar lee directo; al día no ofrece nada; leyendo, tampoco', async () => {
        const { avisoDeLectura } = await import('@nucleo/utils/encuestasLectura');
        let leido = 'no';
        const a = avisoDeLectura({ lectura: { respuestas: 2, nuevas: 2 }, lugares: lugares.slice(0, 1), onLeer: (b) => { leido = b; } });
        a.hacer();
        expect(leido).toBeNull();
        expect(avisoDeLectura({ lectura: { texto: 'x', respuestas: 2, nuevas: 0, minimo_nuevas: 5 }, lugares: lugares.slice(0, 1), onLeer: () => {} })).toBeNull();
        expect(avisoDeLectura({ lectura: { respuestas: 2 }, lugares, leyendo: true, onLeer: () => {} })).toBeNull();
    });
});
