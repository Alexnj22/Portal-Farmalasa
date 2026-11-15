import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// Los precios en la consulta de inventario del Inicio (2026-11-15).
//
// Lo que ancla: que el tope sea Mayoreo Plus PARA TODOS —la consulta pide
// hasta `mayoreo` y nunca `premium`, `precio_7` ni `costo`—, que la
// presentación se proponga a partir del lote de la sala propia, y que el
// precio que se dibuja sea el de esa presentación.
// ═══════════════════════════════════════════════════════════════════════════

const fetchPrecios = vi.fn();
vi.mock('@nucleo/data/productos', () => ({
  fetchPreciosDelProducto: (...a) => fetchPrecios(...a),
}));

import PreciosDelProducto from '../../src/views/dashboard/inventario/PreciosDelProducto';

afterEach(() => { cleanup(); fetchPrecios.mockReset(); });

const PRECIOS = [
  { id_presentacion: 1, activo: true, factor: 1, presentaciones: { tipo: 'UNIDAD' },
    vineta: 1.5, descuento_1: 1.4, vip: 1.3, clinica: 1.2, mayoreo: 1.1 },
  { id_presentacion: 2, activo: true, factor: 10, presentaciones: { tipo: 'CAJA' },
    vineta: 14, descuento_1: 13, vip: 12, clinica: 11, mayoreo: 10.25 },
  { id_presentacion: 3, activo: false, factor: 1, presentaciones: { tipo: 'BLISTER' }, vineta: 9 },
];

const SALAS = [
  { name: 'Bodega', erp: 6, lots: [{ erp_sucursal_id: 6, lote: 'B1', presentacion: 'UNIDAD', cantidad: 40, fecha_vencimiento: '2027-03-01' }] },
  { name: 'Salud 1', erp: 1, lots: [{ erp_sucursal_id: 1, lote: 'S1', presentacion: 'CAJA ', cantidad: 3, fecha_vencimiento: '2027-05-01' }] },
];

describe('PreciosDelProducto', () => {
  it('pide hasta Mayoreo Plus, sin costo, y propone la presentación del lote de la sala propia', async () => {
    fetchPrecios.mockResolvedValue({ data: PRECIOS, error: null });
    const { container, getByText, queryByText } = render(
      <PreciosDelProducto erpProductId={77} salas={SALAS} miErp={1} />,
    );

    expect(fetchPrecios).toHaveBeenCalledWith(77, 'vineta, descuento_1, vip, clinica, mayoreo');

    await waitFor(() => expect(getByText('Mayoreo Plus')).toBeTruthy());
    // La sala propia (Salud 1) tiene CAJA → precios de la caja.
    expect(getByText('$10.25')).toBeTruthy();
    expect(getByText('$14.00')).toBeTruthy();
    expect(queryByText('Premium')).toBeNull();
    expect(queryByText('Precio 7')).toBeNull();
    // Regular arriba y cuatro más en la lista: cinco, ni uno más.
    expect(container.querySelectorAll('dt')).toHaveLength(4);
    // Sólo los lotes de la sala propia: el de Bodega no se ofrece.
    expect(getByText('S1')).toBeTruthy();
    expect(queryByText(/B1/)).toBeNull();
  });

  it('sin precios lo dice', async () => {
    fetchPrecios.mockResolvedValue({ data: [], error: null });
    const { getByText } = render(<PreciosDelProducto erpProductId={5} salas={SALAS} miErp={null} />);
    await waitFor(() => expect(getByText(/no tiene precios registrados/)).toBeTruthy());
  });
});
