import { describe, it, expect } from 'vitest';
import { salaDeSolicitud, reglasDeBandeja, ordenarCola } from '@nucleo/utils/bandejaDeSolicitudes';
import { BRANCH_A_ERP } from '@nucleo/constants/erp';

const permisos = (lista) => (m, a) => lista.includes(`${m}.${a}`);

describe('salaDeSolicitud', () => {
    it('prefiere meta.branch_id, después la del origen, después la de la persona', () => {
        expect(salaDeSolicitud({ metadata: { branch_id: 3 }, employee: { branch_id: 9 } })).toBe('3');
        const [bid, eid] = Object.entries(BRANCH_A_ERP)[0];
        expect(salaDeSolicitud({ metadata: { erp_sucursal_id: eid } })).toBe(String(bid));
        expect(salaDeSolicitud({ metadata: {}, employee: { branch_id: 9 } })).toBe('9');
        expect(salaDeSolicitud({})).toBeNull();
    });
});

describe('reglasDeBandeja', () => {
    const base = { miId: '1', soloMio: false, canApprove: true, hasPermission: permisos([]) };

    it('lo propio se ve siempre', () => {
        const { visible } = reglasDeBandeja({ ...base, canApprove: false, soloMio: true });
        expect(visible({ employee_id: 1, type: 'VACATION', status: 'APPROVED' })).toBe(true);
    });

    it('el traslado nunca se decide por el camino genérico, pero se ve', () => {
        const { visible, puedeDecidir } = reglasDeBandeja(base);
        const r = { employee_id: 2, type: 'INVENTORY_TRANSFER_REQUEST', status: 'PENDING' };
        expect(visible(r)).toBe(true);
        expect(puedeDecidir(r)).toBe(false);
    });

    it('el cambio de turno pendiente sólo lo ve y decide el compañero', () => {
        const r = { employee_id: 2, approver_id: 1, type: 'SHIFT_CHANGE', status: 'PENDING' };
        expect(reglasDeBandeja({ ...base, canApprove: false }).puedeDecidir(r)).toBe(true);
        expect(reglasDeBandeja({ ...base, miId: '5' }).visible(r)).toBe(false);
    });

    it('la familia con módulo propio se decide con SU permiso', () => {
        const r = { employee_id: 2, type: 'DTE_ANULACION', status: 'PENDING' };
        const sin = reglasDeBandeja(base);
        expect(typeof sin.puedeDecidir(r)).toBe('boolean');
    });

    it('quien sólo mira ve la sala entera', () => {
        const { visible } = reglasDeBandeja({ ...base, canApprove: false });
        expect(visible({ employee_id: 2, approver_id: 7, type: 'VACATION', status: 'PENDING' })).toBe(true);
    });

    it('con «sólo míos» se ve sólo lo dirigido a uno', () => {
        const { visible } = reglasDeBandeja({ ...base, soloMio: true, canApprove: false });
        expect(visible({ employee_id: 2, approver_id: 7, type: 'VACATION', status: 'PENDING' })).toBe(false);
        expect(visible({ employee_id: 2, approver_id: 1, type: 'VACATION', status: 'PENDING' })).toBe(true);
    });
});

describe('ordenarCola', () => {
    it('lo pendiente, lo más viejo arriba; lo resuelto, lo más nuevo', () => {
        const p1 = { status: 'PENDING', created_at: '2026-09-01' };
        const p2 = { status: 'PENDING', created_at: '2026-09-05' };
        const a1 = { status: 'APPROVED', created_at: '2026-09-01' };
        const a2 = { status: 'APPROVED', created_at: '2026-09-05' };
        expect(ordenarCola([p2, p1])).toEqual([p1, p2]);
        expect(ordenarCola([a1, a2])).toEqual([a2, a1]);
    });
});
