import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/**
 * El diálogo que reemplazó a la franja de abajo.
 *
 * Lo que hay que anclar no es que se vea: es **a quién le aparece**. La franja
 * anterior sólo salía con `permission === 'default'`, así que los dos estados
 * de los que no se sale solo —bloqueado y equipo de otra persona— no veían
 * nada, y esa era la causa medida de que 24 de 49 empleados no tuvieran avisos.
 * Si alguien vuelve a estrechar la condición, estas cuatro pruebas caen.
 */

const estado = { permission: 'default', subscribed: false, isSupported: true, necesitaInstalar: false, ligado: true };
const subscribe = vi.fn();

vi.mock('../../src/hooks/usePushSubscription', () => ({
    usePushSubscription: () => ({ ...estado, subscribe }),
    esIOS: () => false,
    esApp: () => false,
}));

const { default: AvisosApagadosDialog } = await import('../../src/components/common/AvisosApagadosDialog');

const ponerEstado = (parche) => Object.assign(estado, parche);

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    subscribe.mockClear();
    ponerEstado({ permission: 'default', subscribed: false, isSupported: true, necesitaInstalar: false, ligado: true });
});
afterEach(() => { vi.useRealTimers(); });

/** El diálogo espera 2.5 s para no aparecer de golpe al cargar. */
const dejarloAparecer = () => act(() => { vi.advanceTimersByTime(3000); });

describe('a quién le aparece', () => {
    it('a quien nunca decidió, con el botón que lo resuelve', () => {
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getByText('No vas a recibir avisos')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Activar avisos' })).toBeInTheDocument();
    });

    it('a quien los bloqueó — y con el paso a paso, porque ningún botón lo arregla', () => {
        ponerEstado({ permission: 'denied' });
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getByText('Los avisos están bloqueados')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /activar/i })).toBeNull();
        expect(screen.getByText(/Elige Permitir/)).toBeInTheDocument();
    });

    it('a quien tiene el permiso dado pero el equipo ligado a otra persona', () => {
        ponerEstado({ permission: 'granted', ligado: false });
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getByText('Este equipo avisa a otra persona')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Activar para mí' })).toBeInTheDocument();
    });

    it('al iPhone que todavía no agregó el portal a su inicio', () => {
        ponerEstado({ isSupported: false, necesitaInstalar: true });
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getByText('Agrega el portal a tu inicio')).toBeInTheDocument();
    });

    it('a nadie, si los avisos ya le llegan', () => {
        ponerEstado({ subscribed: true, permission: 'granted' });
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.queryByText(/avisos/i)).toBeNull();
    });

    it('a nadie, si el equipo no puede recibir avisos y no hay paso que dar', () => {
        ponerEstado({ isSupported: false, necesitaInstalar: false });
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('una vez al día', () => {
    it('no vuelve el mismo día aunque se recargue sin contestar', () => {
        const { unmount } = render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getByText('No vas a recibir avisos')).toBeInTheDocument();
        unmount();

        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.queryByText('No vas a recibir avisos')).toBeNull();
    });

    it('vuelve al día siguiente', () => {
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getByText('No vas a recibir avisos')).toBeInTheDocument();

        // El día que quedó guardado es el de ayer.
        localStorage.setItem('avisos_apagados_pospuesto_v1', '2001-01-01');
        render(<AvisosApagadosDialog />);
        dejarloAparecer();
        expect(screen.getAllByText('No vas a recibir avisos').length).toBeGreaterThan(0);
    });
});
