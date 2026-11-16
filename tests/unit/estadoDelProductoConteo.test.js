import { describe, expect, it } from 'vitest';
import { estadoDelProducto, totalesDelProducto } from '@nucleo/utils/conteoDeInventario';

describe('la píldora de un producto en el conteo', () => {
    it('mientras falten renglones, dice cuántos faltan (aunque ya haya diferencia)', () => {
        expect(estadoDelProducto({ item_count: 4, contados_count: 3, diferencia_total: -1 })).toEqual({ texto: 'Faltan 1', tono: 'pendiente' });
    });
    it('contado entero: cuadra, sobra o falta', () => {
        expect(estadoDelProducto({ item_count: 3, contados_count: 3, diferencia_total: 0 }).texto).toBe('Cuadra');
        expect(estadoDelProducto({ item_count: 3, contados_count: 3, diferencia_total: 2 })).toEqual({ texto: '+2', tono: 'sobra' });
        expect(estadoDelProducto({ item_count: 3, contados_count: 3, diferencia_total: -3 })).toEqual({ texto: '-3', tono: 'falta' });
    });
    it('en un conteo ciego no hay diferencia que mostrar', () => {
        expect(estadoDelProducto({ item_count: 2, contados_count: 2, diferencia_total: null }).texto).toBe('Contado');
    });
});

describe('los totales de un producto desde sus renglones', () => {
    it('BEBELAC de Bodega: 2 lotes, +1 y -1, cuadra', () => {
        const t = totalesDelProducto([
            { estado_item: 'CONTADO', fisico_cantidad: 4, diferencia: 1, ver_sistema: true },
            { estado_item: 'CONTADO', fisico_cantidad: 1, diferencia: -1, ver_sistema: true },
        ]);
        expect(t).toEqual({ item_count: 2, contados_count: 2, diferencia_total: 0 });
    });
    it('un grupo mixto suma en unidades', () => {
        const t = totalesDelProducto([
            { estado_item: 'CONTADO', fisico_cantidad: 1, diferencia: -1, factor: 10, grupo_mixto: true, ver_sistema: true },
            { estado_item: 'CONTADO', fisico_cantidad: 4, diferencia: 4, factor: 1, grupo_mixto: true, ver_sistema: true },
        ]);
        expect(t.diferencia_total).toBe(-6);
    });
    it('ciego o sin nada contado: sin diferencia', () => {
        expect(totalesDelProducto([{ estado_item: 'PENDIENTE', fisico_cantidad: null, ver_sistema: true }]).diferencia_total).toBeNull();
        expect(totalesDelProducto([{ estado_item: 'CONTADO', fisico_cantidad: 2, diferencia: null, ver_sistema: false }]).diferencia_total).toBeNull();
    });
});
