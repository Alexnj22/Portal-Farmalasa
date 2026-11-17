/**
 * La página `/foto` respeta QUÉ pide la computadora y CUÁNTAS caben
 * (2026-11-17). Antes todo era «un documento de varias hojas»: el retrato
 * entraba al editor de papel y, donde cabía una sola imagen, se podía juntar
 * un PDF que la computadora rechazaba con el código ya gastado.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const vigente = vi.fn();
vi.mock('@nucleo/data/capturaDesdeElTelefono', () => ({
    capturaVigente: (...a) => vigente(...a),
    mandarFoto: vi.fn(async () => ({ ok: true })),
    mandarTexto: vi.fn(async () => ({ ok: true })),
}));
// El editor real arrastra el lienzo: acá basta saber si se abrió.
vi.mock('../../src/components/common/EditorDeDocumento', () => ({
    default: ({ tipo }) => <div data-testid="editor">{tipo}</div>,
}));
vi.mock('@nucleo/data/recorteSugerido', () => ({ buscarEsquinas: vi.fn(async () => null) }));

import CapturaDeFotoView from '../../src/views/CapturaDeFotoView';

globalThis.URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
globalThis.URL.revokeObjectURL = vi.fn();

const abrir = () => render(
    <MemoryRouter initialEntries={['/foto/ABC']}>
        <Routes><Route path="/foto/:secreto" element={<CapturaDeFotoView />} /></Routes>
    </MemoryRouter>,
);
const foto = () => new File([new Uint8Array([1])], 'f.jpg', { type: 'image/jpeg' });
const elegir = (file) => fireEvent.change(document.getElementById('captura-foto'), { target: { files: [file] } });

describe('CapturaDeFotoView — clase y cantidad', () => {
    beforeEach(() => vigente.mockReset());

    it('un retrato NO abre el editor de papel y, con una sola, ofrece «Tomar otra»', async () => {
        vigente.mockResolvedValue({ ok: true, para: 'Ana', modo: 'foto', clase: 'retrato', forma: null, varias: false });
        abrir();
        await screen.findByText('Tomar la foto');
        elegir(foto());
        await screen.findByText('Mandar la foto');
        expect(screen.queryByTestId('editor')).toBeNull();
        expect(screen.getByText('Tomar otra')).toBeTruthy();
        expect(screen.queryByText('Agregar otra foto')).toBeNull();
        // La segunda reemplaza a la primera: sigue siendo UNA.
        elegir(foto());
        await screen.findByText('1 foto lista');
    });

    it('un documento abre el editor con su forma', async () => {
        vigente.mockResolvedValue({ ok: true, modo: 'foto', clase: 'documento', forma: 'boleta', varias: true });
        abrir();
        await screen.findByText('Tomar la foto');
        elegir(foto());
        await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('boleta'));
    });

    it('una forma que el editor no conoce cae al recuadro de documento', async () => {
        vigente.mockResolvedValue({ ok: true, modo: 'foto', clase: 'documento', forma: 'comprobante', varias: true });
        abrir();
        await screen.findByText('Tomar la foto');
        elegir(foto());
        await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('documento'));
    });

    it('sin los datos nuevos (base vieja) se porta como antes: papel, varias', async () => {
        vigente.mockResolvedValue({ ok: true, modo: 'foto' });
        abrir();
        await screen.findByText(/Si son varias, las vas agregando/);
    });
});
