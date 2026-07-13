import { describe, it, expect } from 'vitest';
import { toDispatch, lotesToDispatch, lotesAsignadosToDispatch } from '../../src/utils/pedidoPrint';

// Regresión: conversión de unidades ERP → unidades de despacho (dispatch_factor)
// para impresión/snapshot de pedidos. Ver memoria del proyecto
// "Pedido Preview Dispatch Rounding" — un bug de doble redondeo ya se corrigió
// aquí antes (v2.2.453); estos tests fijan el comportamiento esperado.
describe('toDispatch', () => {
    it('sin dispatch_factor devuelve la cantidad sin tocar', () => {
        expect(toDispatch(10, 12, null)).toBe(10);
        expect(toDispatch(10, 12, 0)).toBe(10);
    });

    it('dispatch_factor igual al factor ERP devuelve la cantidad sin tocar', () => {
        expect(toDispatch(10, 12, 12)).toBe(10);
    });

    it('convierte proporcionalmente entre factor ERP y factor de despacho', () => {
        // 10 unidades ERP (factor 12) equivalen a 20 unidades de despacho (factor 6)
        expect(toDispatch(10, 12, 6)).toBe(20);
    });

    it('redondea al entero más cercano', () => {
        expect(toDispatch(5, 12, 8)).toBe(Math.round(5 * 12 / 8));
    });
});

describe('lotesToDispatch', () => {
    it('sin dispatch_factor devuelve los lotes sin tocar', () => {
        const lotes = [{ packs: 5 }];
        expect(lotesToDispatch(lotes, 12, null)).toBe(lotes);
    });

    it('convierte packs por lote y filtra los que quedan en 0', () => {
        const lotes = [{ packs: 5 }, { packs: 0 }];
        const result = lotesToDispatch(lotes, 12, 6);
        expect(result).toEqual([{ packs: 10 }]);
    });

    it('lista vacía o nula no revienta', () => {
        expect(lotesToDispatch(null, 12, 6)).toEqual([]);
        expect(lotesToDispatch([], 12, 6)).toEqual([]);
    });
});

describe('lotesAsignadosToDispatch', () => {
    it('convierte "take" resolviendo take/cantidad/packs en ese orden', () => {
        const lotes = [{ take: 5 }, { cantidad: 4 }, { packs: 3 }];
        const result = lotesAsignadosToDispatch(lotes, 12, 6);
        expect(result).toEqual([
            { take: 10 },
            { cantidad: 4, take: 8 },
            { packs: 3, take: 6 },
        ]);
    });

    it('filtra lotes que quedan en 0 unidades de despacho', () => {
        const lotes = [{ take: 0 }, { take: 5 }];
        const result = lotesAsignadosToDispatch(lotes, 12, 6);
        expect(result).toEqual([{ take: 10 }]);
    });
});
