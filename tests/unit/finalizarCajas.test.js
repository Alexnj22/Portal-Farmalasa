import { describe, it, expect } from 'vitest';
import {
    ajustesDeEnvio, ajustesDelSimulacro, alternarCaja, armarCajaMap, armarPaginaItems, asignacionCompleta, asignacionInicial,
    cuantasCajas, despachablesDe,
} from '@nucleo/utils/finalizarCajas';

describe('finalizarCajas', () => {
    it('reparte las hojas parejas entre menos cajas, una por caja si alcanzan', () => {
        expect(asignacionInicial(4, 2)).toEqual([[1], [1], [2], [2]]);
        expect(asignacionInicial(2, 5)).toEqual([[1], [2]]);
    });

    it('una hoja nunca se queda sin caja', () => {
        expect(alternarCaja([[1]], 0, 1)).toEqual([[1]]);
        expect(alternarCaja([[1]], 0, 2)).toEqual([[1, 2]]);
        expect(alternarCaja([[1, 2]], 0, 1)).toEqual([[2]]);
        expect(asignacionCompleta([[1], []], 2)).toBe(false);
        expect(asignacionCompleta([[1], [2]], 2)).toBe(true);
    });

    it('arma el caja_map y las hojas', () => {
        expect(armarCajaMap([[1], [1, 2], [2]], 3)).toEqual({ 1: [1, 2], 2: [2, 3], 3: [] });
        expect(armarPaginaItems([{ ids: [5, 6] }, { ids: [7] }])).toEqual({ 1: [5, 6], 2: [7] });
        expect(cuantasCajas('')).toBe(1);
        expect(cuantasCajas('4')).toBe(4);
    });

    it('sólo las excepciones cuentan como ajuste', () => {
        const items = [{ id: 1, cantidad_asignada: 3 }, { id: 2, cantidad_asignada: 2 }, { id: 3, sin_stock: true, cantidad_asignada: 0 }];
        expect(despachablesDe(items).map(r => r.id)).toEqual([1, 2]);
        expect(ajustesDeEnvio({ 1: { cantidad: 3 }, 2: { cantidad: 0, motivo: 'roto' }, 3: { cantidad: 1 } }, items))
            .toEqual([{ pedido_item_id: 2, cantidad_enviada: 0, motivo: 'roto' }]);
    });

    it('lo que el simulacro no resolvió arranca en cero', () => {
        const items = [{ id: 9, erp_product_id: 100 }];
        expect(ajustesDelSimulacro({ estado: 'en_curso' }, items)).toEqual({});
        expect(ajustesDelSimulacro({ estado: 'verificado', hallazgos: [{ erp_product_id: 100, detalle: 'sin existencia' }] }, items))
            .toEqual({ 9: { cantidad: 0, motivo: 'sin existencia' } });
    });
});
