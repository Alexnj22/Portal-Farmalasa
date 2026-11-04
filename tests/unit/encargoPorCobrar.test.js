import { describe, it, expect } from 'vitest';
import { cifraDeEncargo, encargoPorCobrar, porCobrarDeSala } from '@nucleo/utils/reservasDeSala';

// E-000016 (2026-11-04): «Esperando pago» con la cifra «Pagado $130.00». El
// `anticipo` es lo que el cliente paga desde que se confirma el precio, no lo
// que ya entró: lo que decide es `pago_estado`.
const base = { id: 16, estado: 'confirmado', pago_estado: 'pendiente', anticipo: '130.00', precio_unitario: '130.00', cantidad: 1, reserva_id: null };

describe('encargo por cobrar', () => {
    it('confirmado sin pago: «Por cobrar», no «Pagado»', () => {
        expect(encargoPorCobrar(base)).toBe(true);
        expect(cifraDeEncargo(base)).toEqual({ rotulo: 'Por cobrar', valor: 130, cobrado: false });
    });
    it('ya pagado: «Pagado»', () => {
        const e = { ...base, estado: 'aceptado', pago_estado: 'pagado' };
        expect(encargoPorCobrar(e)).toBe(false);
        expect(cifraDeEncargo(e)).toEqual({ rotulo: 'Pagado', valor: 130, cobrado: true });
    });
    it('el resto de una reserva no se cobra por aquí', () => {
        expect(encargoPorCobrar({ ...base, reserva_id: 9, reserva: 'R-000009' })).toBe(false);
    });
    it('sin monto no hay cifra', () => {
        expect(cifraDeEncargo({ ...base, anticipo: null })).toBeNull();
    });
    it('«Por cobrar» de Apartar lista los mismos encargos', () => {
        const filas = porCobrarDeSala([base, { ...base, id: 17, pago_estado: 'pagado' }], []);
        expect(filas.map((f) => f.clave)).toEqual(['e16']);
    });
});
