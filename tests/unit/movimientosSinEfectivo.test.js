import { describe, expect, it } from 'vitest';
import { filtrarMovimientos, renglonesDeMovimientos } from '@nucleo/utils/movimientosDeCaja';

const tarjeta = { id: 4857, branch_id: 27, tipo: 'ENTRADA', erp_movimiento_id: null, forma_pago: 'TARJETA', monto: 1, comprobante_total: 8.4,
    concepto: 'Aplicacion de inyeccion', numero_boleta: '4792', fecha: '2026-10-19', registrado_at: '2026-10-20T00:22:09Z' };
const anotadoEnCaja = { ...tarjeta, id: 1, erp_movimiento_id: 99, forma_pago: 'EFECTIVO' };

describe('ingresos con tarjeta en la lista de movimientos', () => {
    it('salen como renglón propio', () => {
        const r = renglonesDeMovimientos({ anotados: [tarjeta, anotadoEnCaja] });
        expect(r.map((x) => x.kind)).toEqual(['portal']);
        expect(r[0].fecha).toBe('2026-10-19');
    });
    it('el filtro de salidas los deja fuera y la búsqueda los encuentra por forma', () => {
        const r = renglonesDeMovimientos({ anotados: [tarjeta] });
        expect(filtrarMovimientos(r, { tipo: 'SALIDA' })).toHaveLength(0);
        expect(filtrarMovimientos(r, { busqueda: 'tarjeta' })).toHaveLength(1);
        expect(filtrarMovimientos(r, { estado: 'EDITADOS' })).toHaveLength(0);
    });
    it('una transferencia anulada no sale entre las vigentes', () => {
        const r = renglonesDeMovimientos({ anotados: [{ ...tarjeta, forma_pago: 'TRANSFERENCIA', anulado_at: '2026-10-20T01:00:00Z' }] });
        expect(filtrarMovimientos(r, { estado: 'VIGENTES' })).toHaveLength(0);
    });
});
