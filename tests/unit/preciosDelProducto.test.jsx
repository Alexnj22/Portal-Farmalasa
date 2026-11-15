import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// Los precios del widget «Consulta de precios» (2026-11-15).
//
// Lo que ancla: el tope es Mayoreo Plus PARA TODOS (la consulta nunca pide
// `premium`, `precio_7` ni `costo`); todas las presentaciones a la vez, de la
// más chica a la más grande; dos presentaciones del mismo nombre se funden si
// sus precios son iguales y llevan su código si difieren; los lotes son sólo
// los de la sala propia y la existencia se cuenta por presentación.
// ═══════════════════════════════════════════════════════════════════════════

const fetchPrecios = vi.fn();
vi.mock('@nucleo/data/productos', () => ({
  fetchPreciosDelProducto: (...a) => fetchPrecios(...a),
}));

import PreciosDelProducto from '../../src/views/dashboard/inventario/PreciosDelProducto';
import { presentacionesParaMostrar, agruparPorPresentacion } from '../../src/views/dashboard/inventario/presentacionesDePrecio';

afterEach(() => { cleanup(); fetchPrecios.mockReset(); });

const p = (id, tipo, factor, vineta, extra = {}) => ({
  id_presentacion: id, activo: true, factor, presentaciones: { tipo },
  vineta, descuento_1: vineta - 0.1, vip: vineta - 0.2, clinica: vineta - 0.3, mayoreo: vineta - 0.4, ...extra,
});

const PRECIOS = [
  p(9, 'CAJA', 30, 10.29),
  p(1, 'UNIDAD', 1, 0.34),
  p(102, 'UNIDAD', 1, 0.34),          // igual a la 1: se funde
  p(38, 'CAJA', 30, 12.5),            // mismo nombre que la 9, otro precio: código
  { ...p(36, 'BLISTER', 10, 3), activo: false },
];

const SALAS = [
  { name: 'Bodega', erp: 6, lots: [{ erp_sucursal_id: 6, lote: 'B1', presentacion: 'CAJA', factor: 30, cantidad: 40, fecha_vencimiento: '2027-03-01' }] },
  { name: 'Salud 1', erp: 1, lots: [
    { erp_sucursal_id: 1, lote: 'S1', presentacion: 'CAJA ', factor: 30, cantidad: 3, fecha_vencimiento: '2027-05-01' },
    { erp_sucursal_id: 1, lote: 'S2', presentacion: 'UNIDAD', factor: 1, cantidad: 12, fecha_vencimiento: '2027-01-01' },
  ] },
];

describe('presentacionesParaMostrar', () => {
  it('funde las idénticas, marca las que sólo comparten nombre y ordena por tamaño', () => {
    const lista = presentacionesParaMostrar(PRECIOS, SALAS[1].lots);
    expect(lista.map(x => [x.nombre, x.unidades, x.codigo])).toEqual([
      ['Unidad', 1, null],
      ['Caja', 30, 9],
      ['Caja', 30, 38],
    ]);
    expect(lista[0].existencia).toBe(12);
    expect(lista[1].existencia).toBe(3);
  });
});

describe('agruparPorPresentacion', () => {
  it('junta las dos cajas de 30 en un grupo, ordenadas por el Regular', () => {
    const grupos = agruparPorPresentacion(presentacionesParaMostrar(PRECIOS, SALAS[1].lots));
    expect(grupos.map(g => [g.nombre, g.variantes.map(v => v.precios.vineta)])).toEqual([
      ['Unidad', [0.34]],
      ['Caja', [10.29, 12.5]],
    ]);
  });
});

describe('PreciosDelProducto', () => {
  it('pregunta la presentación y muestra sus dos precios lado a lado con los lotes de la sala', async () => {
    fetchPrecios.mockResolvedValue({ data: PRECIOS, error: null });
    const { getByText, queryByText, container } = render(
      <PreciosDelProducto erpProductId={77} salas={SALAS} miErp={1} />,
    );
    expect(fetchPrecios).toHaveBeenCalledWith(77, 'vineta, descuento_1, vip, clinica, mayoreo');

    await waitFor(() => expect(getByText('¿Qué presentación?')).toBeTruthy());
    fireEvent.click(getByText('Caja'));

    expect(getByText('$10.29')).toBeTruthy();
    expect(getByText('$12.50')).toBeTruthy();
    expect(container.querySelector('.grid-cols-2')).toBeTruthy();
    expect(queryByText('Premium')).toBeNull();
    expect(queryByText('Precio 7')).toBeNull();
    // Lotes: sólo los de la caja en la sala propia.
    expect(getByText('S1')).toBeTruthy();
    expect(queryByText('S2')).toBeNull();
    expect(queryByText('B1')).toBeNull();
  });

  it('sin precios lo dice', async () => {
    fetchPrecios.mockResolvedValue({ data: [], error: null });
    const { getByText } = render(<PreciosDelProducto erpProductId={5} salas={SALAS} miErp={null} />);
    await waitFor(() => expect(getByText(/no tiene precios registrados/)).toBeTruthy());
  });
});
