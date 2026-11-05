// @vitest-environment jsdom
// La baldosa de una fila (vistazo) trae el botón de su acción (2026-11-04):
// «que en chico se pueda USAR, no sólo leer». Sin `ir` abre el contenido
// completo; con `ir`, navega.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import VistazoWidget from '../../src/views/dashboard/VistazoWidget';
import { useResumenWidget } from '../../src/views/dashboard/tamanoWidget';

function Contenido({ resumen }) {
    useResumenWidget(resumen);
    return <p>lista completa</p>;
}

function montar(resumen) {
    return render(
        <MemoryRouter initialEntries={['/inicio']}>
            <Routes>
                <Route path="/inicio" element={
                    <VistazoWidget title="Cortes de caja" icon={Wallet} color="red">
                        <Contenido resumen={resumen} />
                    </VistazoWidget>} />
                <Route path="/bitacoras" element={<p>pantalla de bitácoras</p>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('vistazo con acción', () => {
    it('muestra el número, el texto y el botón', async () => {
        montar({ valor: 2, texto: 'cortes sin confirmar', accion: { texto: 'Confirmar' } });
        expect(await screen.findByText('cortes sin confirmar')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy();
    });

    it('sin `ir`, el botón abre el contenido completo', async () => {
        montar({ valor: 2, texto: 'cortes sin confirmar', accion: { texto: 'Confirmar' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();
    });

    it('con `ir`, navega', async () => {
        montar({ valor: 1, texto: 'lectura toca ahora', accion: { texto: 'Anotar', ir: '/bitacoras' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Anotar' }));
        expect(await screen.findByText('pantalla de bitácoras')).toBeTruthy();
    });

    it('sin acción no hay botón extra', async () => {
        montar({ texto: 'Todo confirmado' });
        await screen.findByText('Todo confirmado');
        expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
    });
});
