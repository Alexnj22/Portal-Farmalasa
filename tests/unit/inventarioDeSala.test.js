import { describe, expect, it } from 'vitest';
import { factorDeDetalle, loteAMostrar, unidadesDeUbicacion, unidadesVencidasPorProducto, vencimientoDe } from '@nucleo/utils/inventarioDeSala';

describe('inventarioDeSala', () => {
    it('factor de la presentación', () => {
        expect(factorDeDetalle('CAJA X30')).toBe(30);
        expect(factorDeDetalle('blister x10')).toBe(10);
        expect(factorDeDetalle('UNIDAD')).toBe(1);
        expect(factorDeDetalle(null)).toBe(1);
    });
    it('unidades de una ubicación', () => {
        expect(unidadesDeUbicacion({ cantidad: 3, detalle: 'CAJA X20' })).toBe(60);
        expect(unidadesDeUbicacion({ cantidad: null })).toBe(0);
    });
    it('franjas de vencimiento en días del calendario', () => {
        const hoy = '2026-10-01';
        expect(vencimientoDe(null, hoy)).toBeNull();
        expect(vencimientoDe('2026-09-30', hoy)).toMatchObject({ dias: -1, vencido: true, franja: 'vencido' });
        expect(vencimientoDe('2026-10-01', hoy).franja).toBe('pronto');
        expect(vencimientoDe('2026-10-31', hoy).franja).toBe('pronto');
        expect(vencimientoDe('2026-11-01', hoy).franja).toBe('trimestre');
        expect(vencimientoDe('2027-03-30', hoy).franja).toBe('semestre');
        expect(vencimientoDe('2027-06-01', hoy).franja).toBe('lejos');
    });
    it('lote a mostrar', () => {
        expect(loteAMostrar({ num_lotes: 0 })).toBe('—');
        expect(loteAMostrar({ num_lotes: '1', lote_sample: 'L9' })).toBe('L9');
        expect(loteAMostrar({ num_lotes: 3, lote_sample: 'L9' })).toBe('VARIOS');
    });
    it('vencidos por sala y producto', () => {
        expect(unidadesVencidasPorProducto([
            { erp_sucursal_id: 1, erp_product_id: 5, cantidad: 2, detalle: 'X10' },
            { erp_sucursal_id: 1, erp_product_id: 5, cantidad: 1 },
        ])).toEqual({ '1_5': 21 });
    });
});
