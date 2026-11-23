// El pedido que abre Vender va a la sucursal de la VENTA (2026-11-23).
// Antes iba siempre a la de quien vende (`miErp`), y quien no tiene sucursal
// propia —Gerencia, Supervisión— lo veía vacío y sin aviso.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ user: { id: 'e1', branchId: 1 }, dondeHay: vi.fn(), crear: vi.fn() }));
vi.mock('@nucleo/context/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
// Sucursal 1 → inventario 1, 25 → 2; la 99 no tiene número de inventario.
vi.mock('@nucleo/constants/erp', async (orig) => ({ ...(await orig()), BRANCH_A_ERP: { 1: 1, 25: 2 } }));
vi.mock('@nucleo/data/dispatchRules', () => ({ fetchMinimoDeDespacho: async () => null }));
vi.mock('@nucleo/data/inventoryMovements', () => ({
    fetchPresentaciones: async () => ({ porProducto: new Map([[7, [{ tipo: 'UNIDAD', factor: 1 }, { tipo: 'CAJA', factor: 10 }]]]) }),
}));
vi.mock('@nucleo/data/inventory', () => ({ fetchInventoryByProductIds: async () => [] }));
vi.mock('@nucleo/data/traslados', () => ({
    crearSolicitudTraslado: h.crear, fetchDondeHay: h.dondeHay, fetchEsAntibiotico: async () => ({ esAntibiotico: false }),
}));

import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import { useComposicionTraslado } from '@nucleo/store/composicionTraslado';

const salas = [
    { erp_sucursal_id: 3, sala: 'Salud 3', unidades: 6 },
    { erp_sucursal_id: 4, sala: 'Salud 4', unidades: 2 },
];
// Lo que abre Vender: el reparto del aviso, de la que más tiene a la que menos.
const desdeVender = { erp_product_id: 7, descripcion: 'BETASERC', origen_sugerido: '3',
    reparto: [{ erp_sucursal_id: 3, unidades: 5 }, { erp_sucursal_id: 4, unidades: 2 }] };
const abrir = (destino) => renderHook(() => usePedirTraslado({ productoInicial: desdeVender, destino }));

describe('pedido de traslado desde Vender: recibe la sucursal de la venta', () => {
    beforeEach(() => {
        h.user = { id: 'e1', branchId: 1, branchName: 'Salud 1' };
        h.dondeHay.mockReset(); h.dondeHay.mockResolvedValue({ donde: salas, error: null });
        h.crear.mockReset(); h.crear.mockResolvedValue({ error: null });
        useComposicionTraslado.getState().limpiar();
    });

    it('vendiendo para otra sucursal, mide y manda contra la de la venta', async () => {
        const r = abrir({ branch_id: 25, nombre: 'Salud 2' });
        await waitFor(() => expect(r.result.current.repartoAplicado).toBe(true));
        expect(h.dondeHay).toHaveBeenCalledWith(7, 2);
        expect(h.dondeHay).not.toHaveBeenCalledWith(7, 1);
        expect(r.result.current.miErp).toBe(2);
        expect(r.result.current.cantidad).toBe('5');
        expect(r.result.current.renglones.map(x => [x.origen.erp_sucursal_id, x.unidades])).toEqual([[4, 2]]);
        await waitFor(() => expect(r.result.current.lineaLista).toBe(true));
        await act(() => r.result.current.enviarSoloEsta('Para un cliente'));
        const md = h.crear.mock.calls[0][0][0].metadata;
        expect(md).toMatchObject({ branch_id: 25, branch_name: 'Salud 2', erp_sucursal_id: 2, origen_erp_sucursal_id: 3 });
    });

    it('quien no tiene sucursal propia pide igual para la de la venta', async () => {
        h.user = { id: 'g1', branchId: null };
        const r = abrir({ branch_id: 25, nombre: 'Salud 2' });
        await waitFor(() => expect(r.result.current.repartoAplicado).toBe(true));
        expect(h.dondeHay).toHaveBeenCalledWith(7, 2);
        expect(r.result.current.cantidad).toBe('5');
        expect(r.result.current.renglones).toHaveLength(1);
    });

    it('con destino sin número de inventario no cae a la de quien vende', async () => {
        const r = abrir({ branch_id: 99, nombre: 'Oficina' });
        await waitFor(() => expect(r.result.current.presentaciones.length).toBeGreaterThan(0));
        expect(r.result.current.miErp).toBeNull();
        expect(r.result.current.conDestino).toBe(true);
        expect(r.result.current.nombreDestino).toBe('Oficina');
        expect(h.dondeHay).not.toHaveBeenCalled();
    });

    it('sin sucursal propia y sin destino, no hay pedido (la pantalla lo dice)', async () => {
        h.user = { id: 'g1', branchId: null };
        const r = renderHook(() => usePedirTraslado({ productoInicial: { erp_product_id: 7, descripcion: 'X' } }));
        await waitFor(() => expect(r.result.current.presentaciones.length).toBeGreaterThan(0));
        expect(r.result.current.miErp).toBeNull();
        expect(r.result.current.conDestino).toBe(false);
        expect(h.dondeHay).not.toHaveBeenCalled();
    });

    it('fuera de Vender sigue recibiendo la sucursal de quien pide', async () => {
        const r = renderHook(() => usePedirTraslado({ productoInicial: { erp_product_id: 7, descripcion: 'X' } }));
        await waitFor(() => expect(h.dondeHay).toHaveBeenCalledWith(7, 1));
        expect(r.result.current.miErp).toBe(1);
        expect(r.result.current.nombreDestino).toBe('Salud 1');
    });
});
