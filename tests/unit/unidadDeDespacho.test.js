import { describe, it, expect } from 'vitest';
import { nombreDeDespacho, paraBodega, esPocoParaMandar, renglonCompleto } from '../../src/utils/unidadDeDespacho';

// Reglas REALES de `unidad_de_despacho` (2026-09-24).
const ELECTROLIT = { tipo: 'FRASCO', etiqueta: 'CAJA', factor: 1, multiplo: 12, unidades: 12 };
const NOR_VOLTEN = { tipo: 'BLISTER', etiqueta: 'BLISTER', factor: 10, multiplo: 5, unidades: 50 };
const SIMILAC    = { tipo: 'UNIDAD', etiqueta: 'UNIDAD', factor: 1, multiplo: 1, unidades: 1 };
const CAJA_X_100 = { tipo: 'CAJA', etiqueta: 'CAJA', factor: 100, multiplo: 1, unidades: 100 };

describe('unidad de despacho', () => {
    it('se nombra como se despacha', () => {
        expect(nombreDeDespacho(ELECTROLIT)).toBe('CAJA de 12');
        expect(nombreDeDespacho(NOR_VOLTEN)).toBe('5 BLISTER X 10');
        expect(nombreDeDespacho(CAJA_X_100)).toBe('CAJA X 100');
    });

    it('a Bodega sólo viaja lo completo, en la presentación de la regla', () => {
        expect(paraBodega(30, ELECTROLIT)).toEqual({ completos: 2, cantidad: 24, viajan: 24, quedan: 6 });
        expect(paraBodega(2, CAJA_X_100)).toEqual({ completos: 0, cantidad: 0, viajan: 0, quedan: 2 });
        expect(paraBodega(3, SIMILAC)).toEqual({ completos: 3, cantidad: 3, viajan: 3, quedan: 0 });
    });

    it('avisa cuando no llega ni a una unidad de despacho', () => {
        expect(esPocoParaMandar(2, CAJA_X_100)).toBe(true);
        expect(esPocoParaMandar(100, CAJA_X_100)).toBe(false);
        expect(esPocoParaMandar(1, SIMILAC)).toBe(false);
    });

    it('un renglón suelto no cumple; uno completo o en presentación mayor sí', () => {
        expect(renglonCompleto({ cantidad: 6, factor: 1 }, ELECTROLIT)).toBe(false);
        expect(renglonCompleto({ cantidad: 24, factor: 1 }, ELECTROLIT)).toBe(true);
        expect(renglonCompleto({ cantidad: 5, factor: 10 }, NOR_VOLTEN)).toBe(true);
        expect(renglonCompleto({ cantidad: 50, factor: 1 }, NOR_VOLTEN)).toBe(false);   // 50 tabletas sueltas
        expect(renglonCompleto({ cantidad: 1, factor: 100 }, NOR_VOLTEN)).toBe(true);   // caja de 100 = 2 unidades de despacho
        expect(renglonCompleto({ cantidad: 7, factor: 1 }, SIMILAC)).toBe(true);
    });
});
