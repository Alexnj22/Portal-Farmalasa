import { describe, it, expect } from 'vitest';
import { totalDevolucion } from '@nucleo/utils/distribucionFacturacion';

// La misma cuenta que `dist_preparar_devolucion` (0017): unidades × precio con
// IVA menos su parte del descuento, por renglón y lote.
const base = [
    { clave: '1:10', item_id: 1, lote_id: 10, disponibles: 5, precio_unitario: 3.39, descuento_unitario: 0.1 },
    { clave: '2:', item_id: 2, lote_id: null, disponibles: 2, precio_unitario: 1.13, descuento_unitario: 0 },
];

describe('devolución: lo que se manda y cuánto es', () => {
    it('suma en centavos y manda sólo lo pedido', () => {
        const r = totalDevolucion([{ ...base[0], pide: '2', destino: 'reingreso' }, { ...base[1], pide: '', destino: 'reingreso' }]);
        expect(r.total).toBe(6.58); // 2 × 3.39 − 2 × 0.10
        expect(r.renglones).toEqual([{ item_id: 1, lote_id: 10, unidades: 2, destino: 'reingreso' }]);
        expect(r.errores).toEqual([]);
    });
    it('más de lo disponible o un decimal es error, y no se manda', () => {
        const r = totalDevolucion([{ ...base[0], pide: '6', destino: 'reingreso' }, { ...base[1], pide: '1.5', destino: 'cuarentena' }]);
        expect(r.errores).toEqual(['1:10', '2:']);
        expect(r.renglones).toEqual([]);
    });
    it('sin lote viaja como null, y la cuarentena se respeta', () => {
        const r = totalDevolucion([{ ...base[1], pide: '1', destino: 'cuarentena' }]);
        expect(r.renglones[0]).toEqual({ item_id: 2, lote_id: null, unidades: 1, destino: 'cuarentena' });
        expect(r.total).toBe(1.13);
    });
});
