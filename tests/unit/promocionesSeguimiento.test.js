import { describe, expect, it } from 'vitest';
import { conteoDePromociones, resumenDeSeguimiento, tonoDeAvance, vendedoresPorSala } from '@nucleo/utils/promocionesUtils';

describe('promociones — lo que la app y el portal cuentan igual', () => {
    it('las tarjetas de Activas', () => {
        const lejos = '2999-12-31';
        const c = conteoDePromociones([
            { estado: 'activa', fin: lejos, abiertos: 3, descuentos: 1 },
            { estado: 'borrador', fin: lejos, abiertos: 2, descuentos: 0 },
        ]);
        expect(c).toMatchObject({ activas: 1, borrador: 1, abiertos: 5, bajanPrecio: 1 });
    });
    it('el resumen del seguimiento', () => {
        const r = resumenDeSeguimiento({
            renglones: [{ vendido_base: 10, documentos: 4, tiene_bono: true }, { vendido_base: 5, documentos: 1 }],
            vendedores: [{ bono: 2.5 }, { bono: '1.5' }],
        });
        expect(r).toEqual({ unidades: 15, documentos: 5, vendedores: 2, bono: 4, conBono: true });
        expect(resumenDeSeguimiento(null)).toMatchObject({ unidades: 0, vendedores: 0, conBono: false });
    });
    it('«quién vendió» por sala: el bono sin dueño no suma a la sala', () => {
        const g = vendedoresPorSala([
            { sala: 'Salud 2', unidades: 1, bono: 1 },
            { sala: 'Salud 2', unidades: 5, bono: 3 },
            { sala: 'Salud 1', unidades: 2, bono: 9, sin_dueno: true },
            { unidades: 1, bono: 1 },
        ]);
        expect(g.map((x) => x.sala)).toEqual(['Salud 1', 'Salud 2', 'Sin sala']);
        expect(g[0].bono).toBe(0);
        expect(g[1]).toMatchObject({ unidades: 6, bono: 4 });
        expect(g[1].gente[0].unidades).toBe(5);
    });
    it('el tono del avance', () => {
        expect(tonoDeAvance(100)).toBe('success');
        expect(tonoDeAvance(85)).toBe('warning');
        expect(tonoDeAvance(10)).toBe('info');
    });
});
