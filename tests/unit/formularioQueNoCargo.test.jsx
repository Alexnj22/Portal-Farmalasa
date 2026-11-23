import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

vi.setConfig({ testTimeout: 20000 });

// ═══════════════════════════════════════════════════════════════════════════
// La ficha que no cargó no se puede guardar (2026-11-23).
//
// En «Corregir descuento» y en «Editar promoción por laboratorio», si la
// lectura fallaba el error se anotaba y el formulario se pintaba IGUAL, con
// los valores vacíos de un alta y el botón de guardar listo en cuanto se
// completara lo mínimo. Guardar mandaba ese formulario como si fuera la ficha:
// pisaba el descuento o la promoción real.
//
// Lo que se ancla: carga que falla → no hay botón de guardar habilitado, sí
// hay «Reintentar», y el guardado no se llama; reintentar y que cargue → el
// formulario vuelve con los datos leídos.
// ═══════════════════════════════════════════════════════════════════════════

const mocks = vi.hoisted(() => ({
    fetchDescuento: vi.fn(),
    guardarDescuento: vi.fn(),
    fetchPromocionLaboratorio: vi.fn(),
    editarPromocionLaboratorio: vi.fn(),
}));

vi.mock('@nucleo/data/descuentos', () => ({
    fetchDescuento: mocks.fetchDescuento,
    guardarDescuento: mocks.guardarDescuento,
    fetchPreciosDeProductos: vi.fn(async () => []),
}));

vi.mock('@nucleo/data/promociones', async (orig) => ({
    ...(await orig()),
    fetchPromocionLaboratorio: mocks.fetchPromocionLaboratorio,
    editarPromocionLaboratorio: mocks.editarPromocionLaboratorio,
    crearPromocionLaboratorio: vi.fn(),
    fetchLaboratorios: vi.fn(async () => []),
    fetchProveedoresDelSistema: vi.fn(async () => []),
}));

vi.mock('@nucleo/store/staffStore', () => {
    const estado = { branches: [{ id: 30, name: 'Sucursal 1' }, { id: 31, name: 'Sucursal 2' }] };
    const useStaffStore = (sel) => (sel ? sel(estado) : estado);
    useStaffStore.getState = () => estado;
    return { useStaffStore, default: useStaffStore };
});

import DescuentoModal from '../../src/views/promociones/DescuentoModal';
import PromocionLaboratorioModal from '../../src/views/promociones/PromocionLaboratorioModal';

const botonGuardar = (texto) => screen.queryAllByRole('button').find((b) => b.textContent.includes(texto));

describe('ficha que no cargó: no se puede guardar', () => {
    beforeEach(() => {
        cleanup();
        Object.values(mocks).forEach((m) => m.mockReset());
    });

    it('Corregir descuento: la carga falla → sin formulario, «Guardar cambios» apagado, «Reintentar»', async () => {
        mocks.fetchDescuento.mockRejectedValueOnce(new Error('Failed to fetch'));
        render(<DescuentoModal open descuentoId={15} alcanceTodo onClose={() => {}} onGuardado={() => {}} />);

        await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
        const guardar = botonGuardar('Guardar cambios');
        expect(guardar).toBeTruthy();
        expect(guardar.disabled).toBe(true);
        fireEvent.click(guardar);
        expect(mocks.guardarDescuento).not.toHaveBeenCalled();
        // Ningún campo del formulario a la vista.
        expect(screen.queryByPlaceholderText(/./)).toBeNull();
    });

    it('Corregir descuento: el descuento no existe → igual que una falla', async () => {
        mocks.fetchDescuento.mockResolvedValueOnce(null);
        render(<DescuentoModal open descuentoId={15} alcanceTodo onClose={() => {}} onGuardado={() => {}} />);
        await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
        expect(botonGuardar('Guardar cambios').disabled).toBe(true);
    });

    it('Corregir descuento: «Reintentar» vuelve a leer y, si carga, pinta el formulario', async () => {
        mocks.fetchDescuento
            .mockRejectedValueOnce(new Error('Failed to fetch'))
            .mockResolvedValueOnce({
                id: 15, descripcion: 'Campaña de prueba', tipo: '%', monto: 10,
                inicio: '2026-11-01', fin: '2026-12-31', todas: true, productos: [],
            });
        render(<DescuentoModal open descuentoId={15} alcanceTodo onClose={() => {}} onGuardado={() => {}} />);
        await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
        fireEvent.click(screen.getByText('Reintentar'));
        await waitFor(() => expect(screen.queryByText('Reintentar')).toBeNull());
        expect(mocks.fetchDescuento).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(screen.getByDisplayValue('Campaña de prueba')).toBeTruthy());
    });

    it('Editar promoción por laboratorio: la carga falla → sin formulario, «Guardar cambios» apagado', async () => {
        mocks.fetchPromocionLaboratorio.mockRejectedValueOnce(new Error('Failed to fetch'));
        render(<PromocionLaboratorioModal open promocionId={7} onClose={() => {}} onGuardada={() => {}} />);

        await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
        const guardar = botonGuardar('Guardar cambios');
        expect(guardar.disabled).toBe(true);
        fireEvent.click(guardar);
        expect(mocks.editarPromocionLaboratorio).not.toHaveBeenCalled();
        expect(screen.queryByPlaceholderText(/./)).toBeNull();
    });

    it('Editar promoción por laboratorio: la promoción no existe → igual que una falla', async () => {
        mocks.fetchPromocionLaboratorio.mockResolvedValueOnce(null);
        render(<PromocionLaboratorioModal open promocionId={7} onClose={() => {}} onGuardada={() => {}} />);
        await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
        expect(botonGuardar('Guardar cambios').disabled).toBe(true);
    });

    it('Editar promoción por laboratorio: «Reintentar» y carga → vuelve el formulario con lo leído', async () => {
        mocks.fetchPromocionLaboratorio
            .mockRejectedValueOnce(new Error('Failed to fetch'))
            .mockResolvedValueOnce({
                id: 7, nombre: 'Promo de prueba', year_month: '2026-11', laboratorios: [{ id: 1, nombre: 'Lab' }],
                niveles: [{ nivel: 1, monto: 10 }], umbrales: [], paga: '', supplier_id: null, nota: '',
            });
        render(<PromocionLaboratorioModal open promocionId={7} onClose={() => {}} onGuardada={() => {}} />);
        await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
        fireEvent.click(screen.getByText('Reintentar'));
        await waitFor(() => expect(screen.getByDisplayValue('Promo de prueba')).toBeTruthy());
    });
});
