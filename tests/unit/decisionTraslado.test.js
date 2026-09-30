import { describe, it, expect } from 'vitest';
import { loQueSeManda, paquetesQueSalen, sugerenciaDeRechazo } from '@nucleo/utils/decisionTraslado';

const items = [
    { descripcion: 'A', cantidad: 3, factor: 10 },
    { descripcion: 'B', cantidad: 2, factor: 1 },
];

describe('paquetesQueSalen', () => {
    it('convierte unidades base a paquetes y nunca pasa de lo pedido', () => {
        expect(paquetesQueSalen({ unidades: 25 }, items[0])).toBe(2);
        expect(paquetesQueSalen({ unidades: 500 }, items[0])).toBe(3);
        expect(paquetesQueSalen({ unidades: 0 }, items[1])).toBe(0);
    });
});

describe('loQueSeManda', () => {
    const lineas = [{ idx: 0, unidades: 30 }, { idx: 1, unidades: 2 }];
    it('todo lo pedido no es recortado', () => {
        const r = loQueSeManda(lineas, items, { 0: '3', 1: '2' });
        expect(r).toMatchObject({ hayQueMandar: true, recortado: false });
        expect(r.aceptadas).toEqual([{ i: 0, cantidad: 3 }, { i: 1, cantidad: 2 }]);
    });
    it('de menos o sin un renglón es recortado', () => {
        expect(loQueSeManda(lineas, items, { 0: '1', 1: '2' }).recortado).toBe(true);
        expect(loQueSeManda(lineas, items, { 0: '3', 1: '0' }).recortado).toBe(true);
    });
    it('nada en físico', () => {
        expect(loQueSeManda([{ idx: 0, unidades: 0 }], items, {}).nadaEnFisico).toBe(true);
    });
});

describe('sugerenciaDeRechazo', () => {
    it('con un renglón no repite el nombre', () => {
        expect(sugerenciaDeRechazo([{ idx: 0, alternativas: [{ sala: 'Salud 1', unidades: 4 }] }], items)).toBe('Sí hay en Salud 1 (4)');
    });
    it('con varios, nombra el producto', () => {
        const r = sugerenciaDeRechazo([{ idx: 0, alternativas: [{ sala: 'S1', unidades: 1 }] }, { idx: 1, alternativas: [] }], items);
        expect(r).toBe('A: S1 (1)');
    });
});
