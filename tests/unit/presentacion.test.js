import { describe, it, expect } from 'vitest';
import { applyPresRule, opcionesDePresentacion, presentacionesEnteras } from '../../src/utils/presentacion';

// Regresión: extraído de TabMinMax.jsx — reglas de negocio que ya rompieron
// en producción (ver PLAN-EJECUCION-2026-07.md, Bloque 2). Convierte
// unidades sueltas a presentaciones (packs/cajas) con la regla del 40%:
// floor(units/factor) + (residuo/factor >= 0.4 ? 1 : 0).
describe('applyPresRule', () => {
    it('sin agrupación (factor <= 1) devuelve las unidades sin tocar', () => {
        expect(applyPresRule(37, 1)).toBe(37);
        expect(applyPresRule(37, 0)).toBe(37);
    });

    it('unidades en 0 o negativas devuelve 0', () => {
        expect(applyPresRule(0, 10)).toBe(0);
        expect(applyPresRule(null, 10)).toBe(0);
        expect(applyPresRule(undefined, 10)).toBe(0);
    });

    it('residuo por debajo del 40% redondea hacia abajo', () => {
        // 22/10 → 2 packs completos + residuo 2 (20% del factor) → no suma
        expect(applyPresRule(22, 10)).toBe(2);
        expect(applyPresRule(23, 10)).toBe(2); // 30%, todavía por debajo
    });

    it('residuo exactamente en el 40% redondea hacia arriba', () => {
        // 24/10 → 2 packs + residuo 4 (exactamente 40% del factor) → suma 1
        expect(applyPresRule(24, 10)).toBe(3);
    });

    it('residuo por encima del 40% redondea hacia arriba', () => {
        expect(applyPresRule(28, 10)).toBe(3); // 80%
    });

    it('múltiplo exacto del factor no agrega residuo', () => {
        expect(applyPresRule(30, 10)).toBe(3);
    });
});

// ── El desplegable de «Presentación» del formulario de traslado ────────────
//
// Estas pruebas existen porque el número entre paréntesis CAMBIÓ de significado
// el 2026-08-19 y los dos se leen igual. Antes era el factor —cuántas unidades
// trae la presentación— y hoy es cuántas de esa presentación se pueden pedir.
// El caso que lo motivó: CLOPRIM X 3 AMPOLLAS con 3 unidades en Bodega ofrecía
// «CAJA X 3 (3)» cuando lo que hay es UNA caja.
//
// El otro riesgo es el redondeo. La regla del 40% de `applyPresRule` vive en
// este mismo archivo y sube un pack con el residuo; usarla acá ofrecería una
// caja que no existe y el pedido lo rechazaría el trigger de la base.

describe('presentacionesEnteras — cuántas CABEN, no cuántas trae', () => {
    it('el caso medido: 3 unidades y una caja de 3 son 1 caja', () => {
        expect(presentacionesEnteras(3, 3)).toBe(1);
    });

    it('redondea hacia abajo SIEMPRE — es un techo, no una sugerencia', () => {
        // Donde `applyPresRule(28, 10)` da 3 —sube por el residuo del 80%—,
        // acá tienen que ser 2: la tercera caja no está.
        expect(presentacionesEnteras(28, 10)).toBe(2);
        expect(applyPresRule(28, 10)).toBe(3);
    });

    it('la presentación suelta cuenta las unidades tal cual', () => {
        expect(presentacionesEnteras(3, 1)).toBe(3);
    });

    it('menos de una presentación es 0, y se dice', () => {
        expect(presentacionesEnteras(3, 40)).toBe(0);
    });

    it('sin factor usable divide por 1, nunca por 0', () => {
        expect(presentacionesEnteras(5, 0)).toBe(5);
        expect(presentacionesEnteras(5, null)).toBe(5);
        expect(presentacionesEnteras(5, undefined)).toBe(5);
    });

    it('sin existencia no hay nada que ofrecer', () => {
        expect(presentacionesEnteras(0, 3)).toBe(0);
        expect(presentacionesEnteras(null, 3)).toBe(0);
        expect(presentacionesEnteras(-4, 3)).toBe(0);
    });
});

describe('opcionesDePresentacion — lo que se lee en el desplegable', () => {
    // Las tres presentaciones activas de CLOPRIM X 3 AMPOLLAS (id 187) en el
    // catálogo de producción, con las 3 unidades que Bodega tiene.
    const cloprim = [
        { tipo: 'UNIDAD',   factor: 1 },
        { tipo: 'CAJA X 3', factor: 3 },
        { tipo: 'CAJA',     factor: 3 },
    ];

    it('dice cuántas hay de cada una, no cuántas unidades trae', () => {
        expect(opcionesDePresentacion(cloprim, 3).map(o => o.label))
            .toEqual(['UNIDAD (3)', 'CAJA X 3 (1)', 'CAJA (1)']);
    });

    it('el valor sigue siendo el índice: es lo que el formulario guarda', () => {
        expect(opcionesDePresentacion(cloprim, 3).map(o => o.value)).toEqual(['0', '1', '2']);
    });

    it('sin sala elegida no inventa un número', () => {
        expect(opcionesDePresentacion(cloprim, null).map(o => o.label))
            .toEqual(['UNIDAD', 'CAJA X 3', 'CAJA']);
    });

    it('escribe el factor sólo cuando dos opciones se llaman igual', () => {
        // CETRADOL X 10 TABLETAS y ACIDO FOLICO 5MG son los 2 productos del
        // catálogo —de 4,377— con la misma etiqueta y dos factores. Sin el
        // «×N» quedarían dos «CAJA» y nada diría cuál es cuál.
        expect(opcionesDePresentacion([
            { tipo: 'CAJA', factor: 1 },
            { tipo: 'CAJA', factor: 10 },
        ], 25).map(o => o.label)).toEqual(['CAJA ×1 (25)', 'CAJA ×10 (2)']);
    });

    it('no lo escribe cuando la etiqueta ya alcanza — 236 tipos dicen «X N» con factor 1', () => {
        // «CAJA X 28» con factor 1 es un producto que se vende por caja: el
        // 28 es lo que trae, no una conversión. «CAJA X 28 ×1» sería ruido.
        expect(opcionesDePresentacion([{ tipo: 'CAJA X 28', factor: 1 }], 5)[0].label)
            .toBe('CAJA X 28 (5)');
    });

    it('lista vacía o ausente no rompe', () => {
        expect(opcionesDePresentacion([], 10)).toEqual([]);
        expect(opcionesDePresentacion(null, 10)).toEqual([]);
    });
});
