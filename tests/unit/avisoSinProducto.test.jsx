// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AvisoSinProducto from '../../src/components/common/AvisoSinProducto';

/**
 * El aviso dice CUÁNTO y CUÁNTOS. Los nombres viven en el desplegable.
 *
 * Estaban en los dos sitios: la frase enumeraba las razones sociales completas
 * —«2 cobros a BANCO PROMERICA, S.A. y LABORATORIOS VIJOSA, S.A. DE C.V.»— y
 * «Ver cuáles» las repetía debajo, una por una y con su motivo. En 390px eso
 * eran **seis líneas** para decir un número, y este aviso vive ARRIBA de la
 * cifra en cuatro pantallas: su alto se paga en todas.
 *
 * Se prueba acá y no en el barrido porque el barrido depende de que el período
 * abierto TENGA un cobro de éstos: sin dato no hay aviso, y «no lo encontré» se
 * lee igual que «está corto». Con datos fabricados, la afirmación es exacta.
 */

const datos = {
    total: 598.14,
    facturas: 2,
    detalle: [
        { invoice_id: 1, cliente: 'BANCO PROMERICA, S.A.', motivo: 'Comisión por servicio de corresponsal' },
        { invoice_id: 2, cliente: 'LABORATORIOS VIJOSA, S.A. DE C.V.', motivo: 'Apoyo promocional' },
    ],
};

describe('AvisoSinProducto', () => {
    it('la frase NO enumera a los clientes', () => {
        render(<AvisoSinProducto datos={datos} contexto="El período que se muestra" />);
        const frase = screen.getByText(/que no son venta de/i).closest('div');
        const texto = frase.textContent.replace(/\s+/g, ' ');
        expect(texto).toContain('598.14');
        expect(texto).toMatch(/2 cobros/);
        // Lo que NO puede estar: la razón social en la frase.
        expect(texto).not.toContain('PROMERICA');
        expect(texto).not.toContain('VIJOSA');
    });

    it('los clientes siguen estando, en el desplegable', () => {
        render(<AvisoSinProducto datos={datos} contexto="El período que se muestra" />);
        // Cerrado: el detalle no se pinta.
        expect(screen.queryByText(/PROMERICA/)).toBeNull();
        // Y el control para abrirlo existe: si se quitaran los nombres de la
        // frase SIN dejar por dónde verlos, el dato se habría perdido.
        expect(screen.getByRole('button', { name: /ver cuáles/i })).toBeTruthy();
    });

    it('sin datos, sin cobros o en cero no pinta nada', () => {
        // Un aviso que dice «cero» es ruido en la pantalla de todos los días.
        const { container: a } = render(<AvisoSinProducto datos={null} />);
        expect(a.innerHTML).toBe('');
        const { container: b } = render(<AvisoSinProducto datos={{ total: 0, facturas: 0, detalle: [] }} />);
        expect(b.innerHTML).toBe('');
    });
});
