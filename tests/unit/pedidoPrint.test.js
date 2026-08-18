import { describe, it, expect } from 'vitest';
import { toDispatch, lotesToDispatch, lotesAsignadosToDispatch, fmtVence } from '../../src/utils/pedidoPrint';

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

// El vencimiento del lote llega como fecha SIN hora ('2027-11-01'). `new Date()`
// la lee como UTC y `toLocaleDateString` la pinta en hora local: en El Salvador
// (UTC−6) toda fecha del día 1 retrocedía un mes. Como 9,774 de las 9,959
// existencias con vencimiento son día 01 (medido en producción el 2026-08-18),
// el desfase no era un borde: era lo que se imprimía casi siempre.
//
// Estas fechas son las que traía el pedido 121 de Salud 3 ese día, no ejemplos
// redactados. Se prueba con `TZ=America/El_Salvador`, que es donde corre.
describe('fmtVence — el huso no puede correr el mes', () => {
    it('el día 01 se queda en SU mes', () => {
        expect(fmtVence('2027-11-01')).toMatch(/nov/i);
        expect(fmtVence('2028-03-01')).toMatch(/mar/i);
        expect(fmtVence('2029-06-01')).toMatch(/jun/i);
        expect(fmtVence('2030-09-01')).toMatch(/sept?/i);
    });

    it('conserva el año de la fecha, no el del corrimiento', () => {
        expect(fmtVence('2028-01-01')).toMatch(/28/);
        expect(fmtVence('2030-01-01')).toMatch(/30/);
    });

    it('sin fecha no inventa una', () => {
        expect(fmtVence(null)).toBeNull();
        expect(fmtVence('')).toBeNull();
        expect(fmtVence('nada')).toBeNull();
    });
});
