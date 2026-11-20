import { describe, it, expect } from 'vitest';
import {
    filtrosParaLaBase, cuantosFiltros, preguntasFiltrables, metaDelFiltro, graficaDe, porcionesDe, CAMPO,
} from '@nucleo/utils/encuestasClientes';

describe('filtrosParaLaBase', () => {
    it('sin nada puesto no manda filtro', () => {
        expect(filtrosParaLaBase({ desde: '', hasta: '', zona: '', pregunta: '', valor: '' })).toBeNull();
        expect(filtrosParaLaBase()).toBeNull();
    });
    it('la pregunta sin valor no filtra', () => {
        expect(filtrosParaLaBase({ pregunta: 'p1', valor: '' })).toBeNull();
    });
    it('manda sólo lo puesto, como texto', () => {
        expect(filtrosParaLaBase({ desde: '2026-11-01', zona: 'z2', pregunta: 'si', valor: true }))
            .toEqual({ desde: '2026-11-01', zona: 'z2', pregunta: 'si', valor: 'true' });
    });
    it('el valor 0 (NPS) sí filtra', () => {
        expect(filtrosParaLaBase({ pregunta: 'nps', valor: 0 })).toEqual({ pregunta: 'nps', valor: '0' });
    });
});

describe('cuantosFiltros', () => {
    it('el rango cuenta uno y la respuesta otro', () => {
        expect(cuantosFiltros({ desde: '2026-11-01', hasta: '2026-11-05', pregunta: 'a', valor: 'b', entrevistador: 'u' })).toBe(3);
        expect(cuantosFiltros({})).toBe(0);
    });
});

const cuestionario = {
    secciones: [{ id: 's1', preguntas: [
        { id: 'a', tipo: 'unica', texto: 'Uno', opciones: [{ id: 'x', texto: 'Equis' }, { id: 'y', texto: 'Ye' }] },
        { id: 'b', tipo: 'texto', texto: 'Comenta' },
        { id: 'c', tipo: 'si_no', texto: '¿Sí?' },
    ] }],
};

describe('preguntasFiltrables', () => {
    it('deja fuera las abiertas y numera como el cuestionario', () => {
        const q = preguntasFiltrables(cuestionario);
        expect(q.map((x) => x.value)).toEqual(['a', 'c']);
        expect(q[1].label).toBe('3. ¿Sí?');
        expect(q[1].opciones).toEqual([{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }]);
    });
});

describe('metaDelFiltro', () => {
    const avance = {
        total: 120, campo: 30,
        por_sucursal: [{ branch_id: 4, meta: 50, respuestas: 40 }, { branch_id: 5, meta: 50, respuestas: 50 }],
        por_zona: [{ id: 'z1', meta: 100, respuestas: 30 }, { id: 'z2', meta: null, respuestas: 0 }],
    };
    const enc = { alcance: 'sucursales', zonas_campo: [{ id: 'z1', meta: 100 }, { id: 'z2' }] };
    it('sin lugar: la meta total', () => {
        expect(metaDelFiltro(enc, avance)).toEqual({ meta: 200, respuestas: 120 });
    });
    it('una sucursal: su cuota', () => {
        expect(metaDelFiltro(enc, avance, { branchId: 4 })).toEqual({ meta: 50, respuestas: 40 });
    });
    it('en alcance general, una sucursal no tiene cuota', () => {
        expect(metaDelFiltro({ ...enc, alcance: 'general' }, avance, { branchId: 4 }).meta).toBeNull();
    });
    it('campo: la suma de las zonas', () => {
        expect(metaDelFiltro(enc, avance, { branchId: CAMPO })).toEqual({ meta: 100, respuestas: 30 });
    });
    it('una zona sin meta', () => {
        expect(metaDelFiltro(enc, avance, { zona: 'z2' })).toEqual({ meta: null, respuestas: 0 });
    });
    it('sin avance todavía', () => {
        expect(metaDelFiltro(enc, null)).toBeNull();
    });
});

describe('graficaDe y porcionesDe', () => {
    it('elige la forma por tipo', () => {
        expect(graficaDe({ tipo: 'unica', opciones: [{ id: 'x', texto: 'X' }] })).toBe('dona');
        expect(graficaDe({ tipo: 'si_no' })).toBe('dona');
        expect(graficaDe({ tipo: 'multiple', opciones: [] })).toBe('barras');
        expect(graficaDe({ tipo: 'nps' })).toBe('barras');
        expect(graficaDe({ tipo: 'ranking' })).toBe('ranking');
        const muchas = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, texto: `O${i}` }));
        expect(graficaDe({ tipo: 'unica', opciones: muchas })).toBe('barras');
    });
    it('cuenta % sobre quienes respondieron', () => {
        const p = { tipo: 'si_no', respuestas: 4, conteo: { true: 3, false: 1 } };
        expect(porcionesDe(p)).toEqual([
            { clave: 'true', label: 'Sí', n: 3, pct: 75 },
            { clave: 'false', label: 'No', n: 1, pct: 25 },
        ]);
    });
    it('sin respuestas, todo en cero', () => {
        expect(porcionesDe({ tipo: 'si_no', respuestas: 0 }).every((c) => c.n === 0 && c.pct === 0)).toBe(true);
    });
});
