import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import AvisoVersionNueva from '../../src/components/common/AvisoVersionNueva';
import { _reiniciarParaPruebas, marcarVersionNueva } from '../../src/utils/versionNueva';

/**
 * El aviso que reemplazó a la recarga sola.
 *
 * La prueba que importa no es que la franja se vea bonita: es que **estar
 * mirando el aviso no recargue nada**. El defecto que esto arregla era
 * silencioso y se llevaba trabajo ajeno, así que lo que hay que anclar es la
 * ausencia de la recarga hasta que alguien aprieta.
 */

let recargar;

beforeEach(() => {
    _reiniciarParaPruebas();
    recargar = vi.fn();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { reload: recargar, pathname: '/pedidos', search: '' },
    });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('la franja', () => {
    it('no se ve mientras no haya versión nueva', () => {
        render(<AvisoVersionNueva />);
        expect(screen.queryByText(/versión nueva/i)).toBeNull();
    });

    it('aparece cuando la hay, y no recarga por aparecer', () => {
        render(<AvisoVersionNueva />);
        act(() => { marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' }); });

        expect(screen.getByText('Hay una versión nueva')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /actualizar/i })).toBeInTheDocument();
        expect(recargar).not.toHaveBeenCalled();
    });

    it('«Ahora no» la calla sin recargar', () => {
        render(<AvisoVersionNueva />);
        act(() => { marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' }); });

        fireEvent.click(screen.getByRole('button', { name: /ahora no/i }));

        expect(screen.queryByText('Hay una versión nueva')).toBeNull();
        expect(recargar).not.toHaveBeenCalled();
    });

    it('«Actualizar» sí recarga: es la decisión de una persona', () => {
        render(<AvisoVersionNueva />);
        act(() => { marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' }); });

        fireEvent.click(screen.getByRole('button', { name: /^actualizar$/i }));

        expect(recargar).toHaveBeenCalledTimes(1);
    });
});

describe('cuando una pantalla ya no abrió', () => {
    it('el aviso sube a diálogo y explica por qué', () => {
        render(<AvisoVersionNueva />);
        act(() => { marcarVersionNueva({ bloqueado: true }); });

        expect(screen.getByText(/no puede abrirse hasta que actualices/i)).toBeInTheDocument();
        expect(recargar).not.toHaveBeenCalled();
    });

    it('y aun así se puede decir «ahora no» sin perder lo que se estaba llenando', () => {
        render(<AvisoVersionNueva />);
        act(() => { marcarVersionNueva({ bloqueado: true }); });

        fireEvent.click(screen.getByRole('button', { name: /ahora no/i }));
        expect(recargar).not.toHaveBeenCalled();
    });
});
