import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

// «Al ingresar un lote se actualiza, así que se pierde tiempo» (Salud 4,
// 2026-11-06). El lote, el vence y la cantidad van EN el renglón: Enter guarda,
// la fila se limpia para la caja siguiente y nada más se mueve.
const showToast = vi.fn();
vi.mock('@nucleo/store/toastStore', () => ({ useToastStore: () => ({ showToast }) }));
vi.mock('@nucleo/data/conteoInventario', () => ({
    fetchProductPresentacionesForConteo: vi.fn(async () => ({ data: [
        { factor: 10, presentaciones: { tipo: 'CAJA' } },
        { factor: 1, presentaciones: { tipo: 'UNIDAD' } },
    ], error: null })),
}));

import LotesEnLinea from '../../src/views/inventario/LotesEnLinea';

const sinLote = { id: 's', erp_product_id: 4836, lote: 'GENERICO', presentacion: 'CAJA', detalle: '1X10', sistema_cantidad: 5 };
const conLote = { ...sinLote, id: 'c', lote: '260330', fecha_vencimiento: '2028-03-01' };

const escribir = (el, valor) => fireEvent.change(el, { target: { value: valor } });

describe('LotesEnLinea', () => {
    beforeEach(() => { cleanup(); showToast.mockReset(); });

    it('en un renglón sin lote trae la fila lista y Enter guarda lote, mes y cantidad', async () => {
        const onGuardar = vi.fn(async () => {});
        render(<LotesEnLinea item={sinLote} onGuardar={onGuardar} />);
        escribir(screen.getByLabelText('Lote'), '260412');
        const vence = screen.getByPlaceholderText('Vence');
        escribir(vence, '0428');
        const cant = screen.getByLabelText(/Cantidad/);
        escribir(cant, '3');
        fireEvent.submit(cant.closest('form'));
        await waitFor(() => expect(onGuardar).toHaveBeenCalledTimes(1));
        // Sin elegir otra, la presentación es la del renglón.
        expect(onGuardar.mock.calls[0][1]).toEqual({ lote: '260412', vence: '2028-04-01', cantidad: '3', presentacion: 'CAJA' });
        // Queda una fila vacía para el lote siguiente.
        await waitFor(() => expect(screen.getByLabelText('Lote').value).toBe(''));
    });

    it('«+ Lote» agrega otra fila, y en un renglón con lote no hay fila hasta pedirla', () => {
        render(<LotesEnLinea item={conLote} onGuardar={vi.fn()} />);
        expect(screen.queryByLabelText('Lote')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Lote/ }));
        expect(screen.getAllByLabelText('Lote')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: /^Lote$/ }));
        expect(screen.getAllByLabelText('Lote')).toHaveLength(2);
    });

    it('con más de una presentación, la fila deja elegirla', async () => {
        render(<LotesEnLinea item={sinLote} onGuardar={vi.fn()} />);
        await waitFor(() => expect(screen.getByLabelText('Presentación')).toBeTruthy());
    });

    it('si falla, la fila se queda como estaba y lo dice', async () => {
        const onGuardar = vi.fn(async () => { throw new Error('Escribe el lote impreso en la caja.'); });
        render(<LotesEnLinea item={sinLote} onGuardar={onGuardar} />);
        escribir(screen.getByLabelText(/Cantidad/), '2');
        fireEvent.submit(screen.getByLabelText(/Cantidad/).closest('form'));
        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(screen.getByLabelText(/Cantidad/).value).toBe('2');
    });
});
