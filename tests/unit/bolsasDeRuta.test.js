import { describe, expect, it } from 'vitest';
import { bolsasEncima, minutosDeDesvio, ordenarSugeridas, rotuloDeSugerida } from '@nucleo/utils/bolsasDeRuta';

// Tres salas en línea (≈1.1 km entre cada una) y una fuera del camino.
const bodega = { lat: 13.70, lng: -89.20 };
const porSucursal = {
    6: bodega,
    4: { lat: 13.71, lng: -89.20 },
    5: { lat: 13.72, lng: -89.20 },
    1: { lat: 13.715, lng: -89.25 },   // ~5.4 km al oeste
};
const paradas = [
    { erp_sucursal_id: 4, entregado_at: null },
    { erp_sucursal_id: 5, entregado_at: null },
];

describe('minutosDeDesvio', () => {
    it('una sala en el camino no cuesta casi nada', () => {
        expect(minutosDeDesvio({ origen_erp: 4, destino_erp: 5 }, paradas, porSucursal, bodega)).toBe(1);
    });
    it('una sala fuera del camino cuesta la ida y vuelta', () => {
        const m = minutosDeDesvio({ origen_erp: 1, destino_erp: 5 }, paradas, porSucursal, bodega);
        expect(m).toBeGreaterThan(10);
    });
    it('sale desde la última parada entregada, no desde la bodega', () => {
        const hechas = [{ erp_sucursal_id: 4, entregado_at: 'x' }, { erp_sucursal_id: 5, entregado_at: null }];
        const desdeBodega = minutosDeDesvio({ origen_erp: 1, destino_erp: 5 }, paradas, porSucursal, bodega);
        const desdeSalud4 = minutosDeDesvio({ origen_erp: 1, destino_erp: 5 }, hechas, porSucursal, bodega);
        expect(desdeSalud4).toBeGreaterThan(0);
        expect(desdeSalud4).toBeLessThanOrEqual(desdeBodega + 1);
    });
    it('sin ubicación o con el destino fuera de lo que falta, no inventa', () => {
        expect(minutosDeDesvio({ origen_erp: 9, destino_erp: 5 }, paradas, porSucursal, bodega)).toBeNull();
        expect(minutosDeDesvio({ origen_erp: 1, destino_erp: 7 }, paradas, porSucursal, bodega)).toBeNull();
        expect(minutosDeDesvio({ origen_erp: 1, destino_erp: 5 }, paradas, porSucursal, null)).toBeNull();
    });
});

describe('rótulos y orden', () => {
    it('rotula', () => {
        expect(rotuloDeSugerida({ categoria: 'en_ruta' }, 5)).toBe('En tu camino');
        expect(rotuloDeSugerida({ categoria: 'desvio' }, 6)).toBe('Desvío de ~6 min');
        expect(rotuloDeSugerida({ categoria: 'desvio' }, null)).toBe('Desvío');
    });
    it('primero lo del camino, después el desvío más corto', () => {
        const r = ordenarSugeridas([
            { codigo: 'a', categoria: 'desvio', m: 9 },
            { codigo: 'b', categoria: 'en_ruta' },
            { codigo: 'c', categoria: 'desvio', m: 3 },
        ], s => s.m);
        expect(r.map(s => s.codigo)).toEqual(['b', 'c', 'a']);
    });
    it('encima = ni entregada ni soltada', () => {
        expect(bolsasEncima([{ id: 1 }, { id: 2, entregada_at: 'x' }, { id: 3, soltada_at: 'x' }]).map(b => b.id)).toEqual([1]);
    });
});
