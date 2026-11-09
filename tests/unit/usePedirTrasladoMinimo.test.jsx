import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const fallo = vi.hoisted(() => ({ minimo: vi.fn() }));
vi.mock('@nucleo/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'e1', branchId: 1 } }) }));
vi.mock('@nucleo/constants/erp', async (orig) => ({ ...(await orig()), BRANCH_A_ERP: { 1: 1 } }));
vi.mock('@nucleo/data/dispatchRules', () => ({ fetchMinimoDeDespacho: fallo.minimo }));
vi.mock('@nucleo/data/inventoryMovements', () => ({
    fetchPresentaciones: async () => ({ porProducto: new Map([[7, [{ tipo: 'BLISTER', factor: 2 }, { tipo: 'CAJA', factor: 10 }]]]) }),
}));
vi.mock('@nucleo/data/inventory', () => ({ fetchInventoryByProductIds: async () => [] }));
vi.mock('@nucleo/data/traslados', () => ({ crearSolicitudTraslado: vi.fn(), fetchDondeHay: vi.fn(), fetchEsAntibiotico: async () => ({ esAntibiotico: false }) }));

import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';

const bodega = { erp_sucursal_id: 6, sala: 'Bodega', unidades: 100 };
const armar = (donde, op = {}) => renderHook(() => usePedirTraslado({
    productoInicial: { erp_product_id: 7, descripcion: 'X', donde, lotesPorSala: {} }, ...op,
}));
const conPresentaciones = (h) => waitFor(() => expect(h.result.current.pres?.tipo).toBe('BLISTER'));

describe('pedir a Bodega respeta su regla de envío', () => {
    beforeEach(() => { fallo.minimo.mockReset(); fallo.minimo.mockResolvedValue({ unidades: 10, texto: '1 CAJA' }); });

    it('no deja pedir menos y deja pedir justo el mínimo', async () => {
        const h = armar([bodega]);
        await conPresentaciones(h);
        await waitFor(() => expect(h.result.current.avisos.minimoBodega?.tono).toBe('danger'));
        expect(h.result.current.lineaLista).toBe(false);
        act(() => h.result.current.setCantidad('5'));
        await waitFor(() => expect(h.result.current.lineaLista).toBe(true));
    });
    it('si no se pudo leer la regla, frena y lo dice', async () => {
        fallo.minimo.mockRejectedValue(new Error('red'));
        const h = armar([bodega]);
        await conPresentaciones(h);
        await waitFor(() => expect(h.result.current.avisos.minimoBodega?.texto).toContain('No se pudo comprobar'));
        expect(h.result.current.lineaLista).toBe(false);
    });
    it.each([
        ['otra sala', [{ erp_sucursal_id: 2, sala: 'Salud 2', unidades: 100 }], {}],
        ['área de próximos a vencer', [{ ...bodega, vencidos: true }], {}],
        ['apartado para cliente', [bodega], { aplicarMinimoDeBodega: false }],
    ])('%s no aplica', async (_, donde, op) => {
        const h = armar(donde, op);
        await conPresentaciones(h);
        await waitFor(() => expect(h.result.current.lineaLista).toBe(true));
        expect(fallo.minimo).not.toHaveBeenCalled();
    });
});
