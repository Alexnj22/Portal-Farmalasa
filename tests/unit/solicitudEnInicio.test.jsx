// @vitest-environment jsdom
// Paso 3 de los widgets del Inicio (2026-11-05): una solicitud se decide sin
// salir del Inicio. Se abre el MISMO diálogo de la bandeja, con el permiso del
// ÁMBITO de cada solicitud, y releída de la base.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const permisos = new Set();
vi.mock('@nucleo/context/AuthContext', () => ({
    useAuth: () => ({
        user: { id: '7' },
        hasPermission: (m, a) => permisos.has(`${m}.${a}`),
        getScope: () => 'ALL',
    }),
}));
vi.mock('@nucleo/store/staffStore', () => ({ useStaffStore: (sel) => sel({ employees: [] }) }));
const showToast = vi.fn();
vi.mock('@nucleo/store/toastStore', () => ({ useToastStore: { getState: () => ({ showToast }) } }));
const fila = vi.fn();
vi.mock('@nucleo/data/requests', () => ({ fetchApprovalRequestById: (id) => fila(id) }));
vi.mock('@nucleo/hooks/useDecidirSolicitud', () => ({ useDecidirSolicitud: () => ({ decidir: vi.fn(), ocupado: false }) }));
vi.mock('../../src/views/solicitudes/TarjetaSolicitud', () => ({ ModalSolicitud: () => null }));

const { useSolicitudEnInicio } = await import('../../src/views/dashboard/useSolicitudEnInicio');

beforeEach(() => { permisos.clear(); showToast.mockClear(); fila.mockReset(); });

async function abrirCon(req) {
    fila.mockResolvedValue({ data: req, error: null });
    const onResuelta = vi.fn();
    const h = renderHook(() => useSolicitudEnInicio({ onResuelta }));
    await act(() => h.result.current.abrir(req.id));
    return { h, onResuelta };
}

const canApproveDe = (h) => h.result.current.dialogo?.props?.children?.props?.canApprove;

describe('decidir una solicitud desde el Inicio', () => {
    it('una personal se decide con el permiso de solicitudes personales', async () => {
        permisos.add('requests_personales.can_approve');
        const { h } = await abrirCon({ id: 'a', type: 'VACATION', status: 'PENDING', employee_id: '9' });
        expect(canApproveDe(h)).toBe(true);
    });

    it('con el permiso de la sala NO alcanza para una personal: se abre sólo para mirar', async () => {
        permisos.add('requests.can_approve');
        const { h } = await abrirCon({ id: 'b', type: 'VACATION', status: 'PENDING', employee_id: '9' });
        expect(h.result.current.dialogo).toBeTruthy();
        expect(canApproveDe(h)).toBe(false);
    });

    it('una de facturación pide el permiso de su familia', async () => {
        permisos.add('requests.can_approve');
        const { h } = await abrirCon({ id: 'c', type: 'ANNULMENT_REQUEST', status: 'PENDING', employee_id: '9' });
        expect(canApproveDe(h)).toBe(false);
    });

    it('si otra persona ya la resolvió, no abre: avisa y la saca de la lista', async () => {
        permisos.add('requests_personales.can_approve');
        const { h, onResuelta } = await abrirCon({ id: 'd', type: 'VACATION', status: 'APPROVED', employee_id: '9' });
        expect(h.result.current.dialogo).toBeFalsy();
        expect(onResuelta).toHaveBeenCalledWith('d');
        expect(showToast).toHaveBeenCalled();
    });
});
