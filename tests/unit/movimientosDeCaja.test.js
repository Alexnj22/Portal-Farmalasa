import { describe, expect, it } from 'vitest';
import { filtrarMovimientos, historiaPorMovimiento, renglonesDeMovimientos } from '@nucleo/utils/movimientosDeCaja';

const movs = [
    { id: 1, branch_id: 2, erp_movimiento_id: 9, fecha: '2026-10-02', concepto: 'POS CAESS', monto: 25.5, tipo: 'ENTRADA', created_at: '2026-10-02T15:00:00Z' },
    { id: 2, branch_id: 2, erp_movimiento_id: 43912, fecha: '2026-10-02', concepto: 'AGUA', monto: 3.25, tipo: 'SALIDA', created_at: '2026-10-02T15:00:00Z', desaparecido_at: '2026-10-02T16:00:00Z' },
];

describe('movimientosDeCaja', () => {
    it('ordena el más reciente primero y desempata el id como número', () => {
        const r = renglonesDeMovimientos({ movimientos: movs });
        expect(r.map((x) => x.mv.erp_movimiento_id)).toEqual([43912, 9]);
    });
    it('filtra por tipo, estado y búsqueda', () => {
        const r = renglonesDeMovimientos({ movimientos: movs });
        const porMov = historiaPorMovimiento([{ branch_id: 2, erp_movimiento_id: 9, cambio: 'EDITADO' }]);
        expect(filtrarMovimientos(r, { tipo: 'ENTRADA' }).length).toBe(1);
        expect(filtrarMovimientos(r, { estado: 'DESAPARECIDOS' })[0].mv.id).toBe(2);
        expect(filtrarMovimientos(r, { estado: 'EDITADOS', porMov })[0].mv.id).toBe(1);
        expect(filtrarMovimientos(r, { busqueda: 'agua' })[0].mv.id).toBe(2);
    });
});
