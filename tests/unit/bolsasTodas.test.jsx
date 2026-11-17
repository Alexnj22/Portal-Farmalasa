import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@nucleo/data/bolsas', () => ({
  fetchBolsas: vi.fn(async () => ([
    { id: 1, folio: 'S1-001', branch_id: 1, fecha: '2026-11-03', hora: '19:10:00', caja: '1', estado: 'CONTADA', monto_inicial: 100, contado: 95, contado_por: 7, contado_at: '2026-11-04T15:00:00Z', cerrada_por: 7 },
    { id: 2, folio: 'S1-002', branch_id: 1, fecha: '2026-11-10', hora: '20:00:00', caja: '2', estado: 'ABIERTA', monto_inicial: 50, cerrada_por: 7 },
    { id: 3, folio: 'S2-003', branch_id: 2, fecha: '2026-11-12', hora: '08:00:00', caja: '1', estado: 'ANULADA', monto_inicial: 20, cerrada_por: 7 },
  ])),
  fetchSaldos: vi.fn(async (ids) => new Map(ids.map((id) => [id, { bolsa_id: id, saldo: id === 1 ? 100 : id === 2 ? 50 : 0 }]))),
  fetchPersonasDeBolsas: vi.fn(async () => [{ id: 7, name: 'Ana Pérez López' }]),
}));

import TodasLasBolsas from '../../src/views/bolsas/TodasLasBolsas';

describe('TodasLasBolsas', () => {
  it('pinta sin romper, con montos y sin montos', async () => {
    for (const verMontos of [true, false]) {
      const onMetricas = vi.fn();
      const onOpciones = vi.fn();
      const { unmount } = render(<MemoryRouter><TodasLasBolsas desde="2026-11-01" hasta="2026-11-15" nombreSala={{ 1: 'Salud 1', 2: 'Salud 2' }} verMontos={verMontos} onAbrir={() => {}} onMetricas={onMetricas} onOpciones={onOpciones} /></MemoryRouter>);
      await waitFor(() => expect(screen.getAllByText(/S1-002/).length).toBeGreaterThan(0));
      expect(screen.getAllByText(/Anulada/).length).toBeGreaterThan(0);
      if (verMontos) {
        expect(screen.getAllByText(/Faltó/).length).toBeGreaterThan(0);
        await waitFor(() => expect(onMetricas.mock.calls.at(-1)[0].length).toBe(4));
      }
      expect(onOpciones.mock.calls.at(-1)[0].map((o) => o.label)).toContain('Anuladas (1)');
      unmount();
    }
  });
});

describe('TodasLasBolsas con filtro', () => {
  it('«Pendientes» deja sólo las que siguen en el circuito', async () => {
    render(<MemoryRouter><TodasLasBolsas desde="2026-11-01" hasta="2026-11-15" filtro="pendiente" nombreSala={{ 1: 'Salud 1', 2: 'Salud 2' }} verMontos onAbrir={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/S1-002/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/S1-001/)).toBeNull();
    expect(screen.queryByText(/S2-003/)).toBeNull();
  });
});
