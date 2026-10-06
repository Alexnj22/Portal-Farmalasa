import { describe, expect, it } from 'vitest';
import {
    copiarUmbralesDeSala, payloadDePromocionLaboratorio, problemasDePromocionLaboratorio, quitarNivelDePromocion,
} from '@nucleo/utils/promocionesUtils';
import { categoriaDeAntiguedad } from '@nucleo/utils/climaLaboral';

const salas = [{ id: 1, name: 'Salud 1' }, { id: 2, name: 'Salud 2' }];
const niveles = [{ nivel: 1, monto: '10' }, { nivel: 2, monto: '20' }];
const base = { nombre: 'Lab X', mes: '2026-10', labs: [{ id: 5 }], niveles, salas, paga: '', supplierId: '' };

describe('problemasDePromocionLaboratorio', () => {
    it('acepta umbrales que suben con el nivel', () => {
        expect(problemasDePromocionLaboratorio({ ...base, umbrales: { '1:1': '100', '1:2': '200' } })).toEqual([]);
    });
    it('frena un nivel que no pide más venta que el anterior', () => {
        const p = problemasDePromocionLaboratorio({ ...base, umbrales: { '1:1': '200', '1:2': '200' } });
        expect(p).toContain('En Salud 1 el nivel 2 no pide más venta que el anterior.');
    });
    it('frena sin umbrales y proveedor sin elegir', () => {
        const p = problemasDePromocionLaboratorio({ ...base, umbrales: {}, paga: 'proveedor' });
        expect(p).toContain('Ninguna sala tiene umbral: nadie podría alcanzar un nivel.');
        expect(p).toContain('Elige el proveedor que paga.');
    });
});

describe('formulario por laboratorio', () => {
    it('arma el payload sin umbrales vacíos', () => {
        const r = payloadDePromocionLaboratorio({ ...base, umbrales: { '1:1': '100', '2:1': '' }, nota: '  ' });
        expect(r.umbrales).toEqual([{ branch_id: 1, nivel: 1, umbral: 100 }]);
        expect(r.nota).toBeNull();
        expect(r.laboratorios).toEqual([5]);
    });
    it('quitar un nivel renumera niveles y umbrales', () => {
        const r = quitarNivelDePromocion([{ nivel: 1 }, { nivel: 2 }, { nivel: 3 }], { '1:1': 'a', '1:2': 'b', '1:3': 'c' }, 2);
        expect(r.niveles.map((n) => n.nivel)).toEqual([1, 2]);
        expect(r.umbrales).toEqual({ '1:1': 'a', '1:2': 'c' });
    });
    it('copiar no pisa una sala que ya tiene umbrales', () => {
        const u = copiarUmbralesDeSala({ '1:1': '100', '1:2': '200' }, [...salas, { id: 3 }], niveles, 1);
        expect(u['2:1']).toBe('100');
        const v = copiarUmbralesDeSala({ '1:1': '100', '2:1': '50' }, salas, niveles, 1);
        expect(v['2:1']).toBe('50');
    });
});

describe('categoriaDeAntiguedad', () => {
    const ahora = new Date('2026-10-06T12:00:00Z').getTime();
    it('A/B/C/D por meses', () => {
        expect(categoriaDeAntiguedad('2026-03-01', ahora)).toBe('A');
        expect(categoriaDeAntiguedad('2024-10-01', ahora)).toBe('B');
        expect(categoriaDeAntiguedad('2022-01-01', ahora)).toBe('C');
        expect(categoriaDeAntiguedad('2019-01-01', ahora)).toBe('D');
        expect(categoriaDeAntiguedad(null, ahora)).toBeNull();
    });
});
