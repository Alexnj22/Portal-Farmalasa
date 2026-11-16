import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Corregir un lote (2026-11-16) usa la misma pieza que traslados, con dos
// agregados: `excluir` (el par que se corrige no choca consigo mismo) y
// `permitirOtraFecha` (salida cuando las dos fechas registradas están mal).
// El caso real: ZALDIAR LJ2506901, registrado 10/2027 (mal) y 09/2028 (bien).
vi.mock('@nucleo/data/traslados', () => ({
    fetchLotesConocidosDeProducto: async () => ([
        { lote: 'LJ2506901', vence: '2027-10', fecha: '2027-10-01', veces: 1 },
        { lote: 'LJ2506901', vence: '2028-09', fecha: '2028-09-01', veces: 6 },
    ]),
}));
const LoteDeLaCaja = (await import('../../src/views/traslados/LoteDeLaCaja.jsx')).default;

function Envoltura({ inicial, onValor, ...props }) {
    const [v, setV] = useState(inicial);
    return <LoteDeLaCaja erpProductId={1279} producto="ZALDIAR" valor={v} onChange={(x) => { setV(x); onValor?.(x); }} {...props} />;
}

describe('LoteDeLaCaja al corregir', () => {
    it('con el par de origen excluido, elegir la fecha registrada buena se puede mandar', async () => {
        let ultimo = null;
        render(<Envoltura inicial={{ lote: 'LJ2506901', vence: '2028-09' }} onValor={(x) => { ultimo = x; }}
            excluir={{ lote: 'LJ2506901', fecha: '2027-10-01' }} permitirOtraFecha />);
        await waitFor(() => expect(ultimo?.envio).toEqual({ lote: 'LJ2506901', vence: '2028-09-01' }));
    });

    it('una TERCERA fecha choca con la registrada, y «Esa fecha también está mal» la deja pasar', async () => {
        let ultimo = null;
        render(<Envoltura inicial={{ lote: 'LJ2506901', vence: '2029-01' }} onValor={(x) => { ultimo = x; }}
            excluir={{ lote: 'LJ2506901', fecha: '2027-10-01' }} permitirOtraFecha />);
        const boton = await screen.findByRole('button', { name: /también está mal/ });
        expect(ultimo?.envio ?? null).toBeNull();
        fireEvent.click(boton);
        await waitFor(() => expect(ultimo?.envio).toEqual({ lote: 'LJ2506901', vence: '2029-01-01' }));
    });

    it('sin `permitirOtraFecha` (traslados) no aparece la salida', async () => {
        render(<Envoltura inicial={{ lote: 'LJ2506901', vence: '2029-01' }} />);
        await screen.findByText(/Un lote tiene un solo vencimiento/);
        expect(screen.queryByRole('button', { name: /también está mal/ })).toBeNull();
    });
});
