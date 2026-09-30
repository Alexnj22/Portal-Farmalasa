import { describe, it, expect } from 'vitest';
import { esAnulada, estadoDeLaCaja, pagosPosibles, solicitudDeFacturacion, ambitoDeFacturas } from '@nucleo/utils/solicitudFacturacion';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';

describe('solicitudFacturacion', () => {
    it('una anulada son los DOS estados', () => {
        expect(esAnulada({ estado: 'NULA' })).toBe(true);
        expect(esAnulada({ estado: 'DTE INVALIDADO EN MH' })).toBe(true);
        expect(esAnulada({ estado: 'FINALIZADA' })).toBe(false);
    });
    it('la caja con duda no es «abierta»', () => {
        expect(estadoDeLaCaja(true)).toBe('abierta');
        expect(estadoDeLaCaja(false)).toBe('cerrada');
        expect(estadoDeLaCaja(null)).toBe('desconocido');
        expect(estadoDeLaCaja('cargando')).toBe('cargando');
    });
    it('no se cambia a la misma forma de pago ni a crédito', () => {
        expect(pagosPosibles('efectivo')).not.toContain('efectivo');
        expect(pagosPosibles('efectivo')).not.toContain('credito');
    });
    it('el sobre lleva la factura, la sala, el aviso y lo propio', () => {
        const s = solicitudDeFacturacion('PAYMENT_CHANGE_REQUEST', {
            inv: { id: 1, erp_invoice_id: 9, correlativo: 'A', fecha: '2026-09-30', total: 5, tipo_documento: 'FCF' },
            usuarioId: 'u', sala: { id: 2, name: 'La Popular' }, aprobador: { id: 's', name: 'Sup' }, nota: '  ',
            extra: { current_pago: 'efectivo', new_pago: 'tarjeta' },
        });
        expect(s).toMatchObject({ employee_id: 'u', approver_id: 's', type: 'PAYMENT_CHANGE_REQUEST', status: 'PENDING', note: null });
        expect(s.metadata).toMatchObject({ invoice_id: 1, erp_invoice_id: 9, branch_id: 2, new_pago: 'tarjeta', notified_employee: 'Sup' });
    });
    it('el ámbito es el mes o el día', () => {
        expect(ambitoDeFacturas('2026-09-02')).toEqual({ fecha: '2026-09-02' });
        expect(ambitoDeFacturas()).toHaveProperty('from');
    });
});

describe('supervisorQueResuelve', () => {
    it('Supervisión disponible primero; si no, dirección', () => {
        const e = [
            { id: 1, status: 'ACTIVO', role_id: 13, activeEventType: 'VACATION' },
            { id: 2, status: 'ACTIVO', role_id: 13 },
            { id: 3, status: 'ACTIVO', rango: 5 },
        ];
        expect(supervisorQueResuelve(e).id).toBe(2);
        expect(supervisorQueResuelve([e[0], e[2]]).id).toBe(3);
    });
});
