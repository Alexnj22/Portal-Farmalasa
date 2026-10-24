import { describe, expect, it } from 'vitest';
import { construirInformeDoc, construirInformeHtml } from '@nucleo/utils/marketingInforme';

// El informe del mes para la reunión de gerencia. Lo que se prueba es lo que
// el papel DICE: los conteos del resumen, la pauta con sus totales, cuándo
// aparece la sección de ventas de la promoción, y que el HTML de la app diga
// lo mismo que el PDF del portal (sale del mismo documento).

const mes = { mes: '2026-10-01', estado: 'en_revision', version: 2, objetivo: 'Lanzar la tarjeta', presupuesto_pauta: 200 };
const marcas = { 1: { nombre: 'Farmacia Salud' }, 2: { nombre: 'Torogoz' } };
const redes = [{ clave: 'instagram', nombre: 'Instagram' }, { clave: 'facebook', nombre: 'Facebook' }];

const pieza = (id, estado, extra = {}) => ({
    id, estado, titulo: `Pieza ${id}`, fecha: '2026-10-10', formato: 'post', marca_id: 1, marcas: [1], redes: ['instagram'], ...extra,
});

// Junta todo el texto de un nodo de pdfmake, para buscar frases sin depender
// de la forma exacta del árbol.
const textoDe = (n) => {
    if (n == null) return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textoDe).join(' ');
    if (n.table) return n.table.body.map(textoDe).join(' ');
    if (n.columns) return n.columns.map((c) => textoDe(c.stack)).join(' ');
    return textoDe(n.text);
};
const todo = (doc) => doc.content.map(textoDe).join('\n');
const tablaTras = (doc, titulo) => {
    const i = doc.content.findIndex((n) => n.text === titulo);
    return i < 0 ? null : doc.content[i + 1];
};

describe('construirInformeDoc — el resumen del mes', () => {
    const piezas = [
        pieza('a', 'publicado'), pieza('b', 'programado'), pieza('c', 'aprobado'),
        pieza('d', 'finalizado'), pieza('e', 'pendiente'), pieza('f', 'cambios'),
    ];
    const doc = construirInformeDoc({ mes, piezas, marcas, redes });

    it('cuenta publicadas, programadas, listas sin salir y sin terminar', () => {
        const [, fila] = tablaTras(doc, 'Resumen').table.body;
        const valor = (c) => (typeof c === 'object' ? c.text : c);
        expect(fila.map(valor)).toEqual(['6', '1', '1', '2', '2']);
    });

    it('el subtítulo nombra el estado del mes y la versión cuando hubo reenvío', () => {
        expect(doc.content[1].text).toMatch(/calendario en revisión \(versión 2\)/);
        const v1 = construirInformeDoc({ mes: { ...mes, version: 1 }, piezas, marcas, redes });
        expect(v1.content[1].text).not.toMatch(/versión/);
    });

    it('una pieza de dos marcas cuenta para las dos', () => {
        const d = construirInformeDoc({ mes, piezas: [pieza('x', 'pendiente', { marcas: [1, 2] })], marcas, redes });
        const texto = todo(d);
        expect(texto).toContain('Farmacia Salud: 1');
        expect(texto).toContain('Torogoz: 1');
    });

    it('sin el arreglo de marcas usa la marca principal', () => {
        const d = construirInformeDoc({ mes, piezas: [pieza('x', 'pendiente', { marcas: [], marca_id: 2 })], marcas, redes });
        expect(todo(d)).toContain('Torogoz: 1');
    });

    it('las redes salen con su nombre, no con la clave', () => {
        const filas = tablaTras(doc, 'Calendario').table.body.slice(1);
        expect(filas[0][4]).toBe('Instagram');
    });

    it('sin objetivo no deja un renglón vacío', () => {
        const d = construirInformeDoc({ mes: { ...mes, objetivo: '' }, piezas, marcas, redes });
        expect(d.content.every(Boolean)).toBe(true);
        expect(todo(d)).not.toContain('Objetivo:');
    });
});

describe('construirInformeDoc — la pauta', () => {
    it('sin piezas pautadas lo dice en vez de pintar una tabla vacía', () => {
        const d = construirInformeDoc({ mes, piezas: [pieza('a', 'publicado')], marcas, redes });
        expect(todo(d)).toContain('Sin pauta este mes.');
    });

    it('la fila de total suma presupuesto, gastado y resultados, y la nota dice lo sin asignar', () => {
        const piezas = [
            pieza('a', 'publicado', { pauta: { objetivo: 'mensajes', presupuesto: 50, gastado: 40, alcance: 1000, mensajes: 20, clics: 0 } }),
            pieza('b', 'publicado', { pauta: { objetivo: 'alcance', presupuesto: 30, gastado: null, alcance: null, mensajes: null, clics: null } }),
        ];
        const d = construirInformeDoc({ mes, piezas, marcas, redes });
        const body = tablaTras(d, 'Pauta').table.body;
        const total = body[body.length - 1].map((c) => (typeof c === 'object' ? c.text : c));
        expect(total[0]).toBe('Total');
        expect(total[2]).toMatch(/80/);
        expect(total[3]).toMatch(/40/);
        // Un gasto todavía sin anotar sale como raya, no como $0.00.
        expect(body[2][3].text).toBe('—');
        const nota = todo(d);
        expect(nota).toMatch(/sin asignar \$?\s*120/);
        // 40 / 20 mensajes = 2; sin clics no se inventa un costo por clic.
        expect(nota).toMatch(/costo por mensaje \$?\s*2\.00/);
        expect(nota).not.toMatch(/costo por clic/);
    });
});

describe('construirInformeDoc — ventas de las promociones', () => {
    const efecto = { dias: 7, antes: { monto: 100, unidades: 10 }, durante: { monto: 150, unidades: 15 } };

    it('sólo aparece con una pieza ligada a promoción que ya tiene efecto medido', () => {
        const sinEfecto = construirInformeDoc({ mes, piezas: [pieza('a', 'publicado', { promocion_id: 9 })], marcas, redes, efectos: {} });
        expect(todo(sinEfecto)).not.toContain('Ventas de las promociones');
        const sinPromo = construirInformeDoc({ mes, piezas: [pieza('a', 'publicado')], marcas, redes, efectos: { a: efecto } });
        expect(todo(sinPromo)).not.toContain('Ventas de las promociones');
    });

    it('compara antes contra durante y da el cambio en porcentaje', () => {
        const d = construirInformeDoc({ mes, piezas: [pieza('a', 'publicado', { promocion_id: 9 })], marcas, redes,
            efectos: { a: efecto }, promociones: { 9: { nombre: 'Octubre rosa' } } });
        const fila = tablaTras(d, 'Ventas de las promociones').table.body[1];
        expect(fila[0].text).toContain('Octubre rosa');
        expect(fila[1]).toBe('7');
        expect(fila[4].text).toMatch(/50/);
    });

    it('sin ventas antes no divide por cero: lo dice con palabras', () => {
        const d = construirInformeDoc({ mes, piezas: [pieza('a', 'publicado', { promocion_id: 9 })], marcas, redes,
            efectos: { a: { ...efecto, antes: { monto: 0, unidades: 0 } } } });
        const fila = tablaTras(d, 'Ventas de las promociones').table.body[1];
        expect(fila[4].text).toBe('sin ventas antes');
    });
});

describe('construirInformeHtml — el mismo informe para la app', () => {
    const piezas = [pieza('a', 'publicado', { titulo: 'Promo <b>2x1</b> & más' })];
    const html = construirInformeHtml({ mes, piezas, marcas, redes });

    it('es un documento completo, tamaño carta', () => {
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('size: letter');
    });

    it('escapa el texto que escribió el usuario', () => {
        expect(html).toContain('Promo &lt;b&gt;2x1&lt;/b&gt; &amp; más');
        expect(html).not.toContain('<b>2x1</b>');
    });

    it('dice lo mismo que el PDF: las mismas secciones y la misma tabla del calendario', () => {
        for (const t of ['Informe de marketing', 'Resumen', 'Por marca', 'Calendario', 'Pauta', 'Sin pauta este mes.']) {
            expect(html).toContain(t);
        }
        expect((html.match(/<table>/g) || []).length).toBe(2);   // resumen + calendario
    });
});
