import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@nucleo/data/bolsas', () => ({
  anularBolsa: vi.fn(), anularLaSalidaDeBolsa: vi.fn(),
  fetchSalidasDeBolsa: vi.fn(async () => []),
  fetchEstadosDeDiferenciaDeCortes: vi.fn(async () => new Map([[55, { estado: 'resuelto', resoluciones: [{ id: 1, via: 'JUSTIFICA', causa: 'Salida de un adelanto sin anotar', monto: 2.5, registrado_nombre: 'EDWIN ALEXANDER NUNEZ JOYA', evidencia_ref: 'INGRESO' }] }]])),
  fetchDiferenciaDeUnCorte: vi.fn(async () => 2.5),
  fetchEventosDeBolsa: vi.fn(async () => ([
    { id: 3, accion: 'CONTAR', nombre: 'CELINA BEATRIZ ESCOBAR ESCOBAR', employee_id: 9, created_at: '2026-11-13T20:37:00Z', motivo: 'No cuadró.' },
    { id: 2, accion: 'RECIBIR', nombre: 'CELINA BEATRIZ ESCOBAR ESCOBAR', employee_id: 9, created_at: '2026-11-13T20:18:00Z' },
    { id: 1, accion: 'CREAR', nombre: 'MARIA NATALY FLORES TEJADA', employee_id: 8, created_at: '2026-11-13T03:03:00Z' },
  ])),
}));
vi.mock('@nucleo/hooks/useCerrarBolsa', () => ({ default: () => ({ imprimirValeDeOperacion: vi.fn(), reimprimirEtiqueta: vi.fn() }) }));
vi.mock('@nucleo/context/AuthContext', () => { const a = () => ({ hasPermission: () => true, user: null }); return { useAuth: a, useAuthSiHay: a }; });

import DetalleDeBolsa from '../../src/components/bolsas/DetalleDeBolsa';

describe('DetalleDeBolsa', () => {
  it('muestra estado, cifras, recorrido e historial con nombre corto', async () => {
    render(<DetalleDeBolsa sala="La Popular" onClose={() => {}} bolsa={{
      id: 1, folio: 'LP-2124', corte_id: 55, branch_id: 1, fecha: '2026-11-12', hora: '21:03:00', caja: 'MI CAJA',
      estado: 'CONTADA', monto_inicial: 774.07, contado: 770.07, contado_at: '2026-11-13T20:37:00Z',
      cerrada_at: '2026-11-13T03:03:00Z', recibida_at: '2026-11-13T20:18:00Z', dif_causa: 'Faltaron 4 dólares', dif_at: '2026-11-13T20:37:00Z',
    }} />);
    await waitFor(() => expect(screen.getAllByText(/Se recibió/).length).toBeGreaterThan(0));
    expect(screen.getByText('Diferencia del conteo')).toBeTruthy();
    expect(screen.getAllByText(/Faltó \$4\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Diferencia del corte')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Sobró \$2\.50/).length).toBeGreaterThan(0));
    expect(screen.queryByText('LP-2124')).toBeNull();
    await waitFor(() => expect(screen.getAllByText('Resuelto').length).toBeGreaterThan(0));
    expect(screen.getByText('Qué pasó con el corte')).toBeTruthy();
    expect(screen.getByText('Salida de un adelanto sin anotar')).toBeTruthy();
    expect(screen.getByText(/Lo resolvió EDWIN NUNEZ/)).toBeTruthy();
    expect(screen.getAllByText('Depositada').length).toBe(1);
    expect(screen.queryByText(/CELINA BEATRIZ ESCOBAR ESCOBAR/)).toBeNull();
    expect(screen.getAllByText(/Faltaron 4 dólares/).length).toBe(1);
  });
});
