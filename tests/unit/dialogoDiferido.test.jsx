import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { dialogoDiferido } from '../../src/utils/dialogoDiferido';

// Un diálogo que se baja al abrirlo.
//
// **Estas pruebas existen porque lo que se rompe acá no se ve.** Si el latch
// deja de funcionar, el `lazy()` se renderiza apenas carga la pantalla, el
// trozo se descarga igual que antes y **todo sigue andando** — sólo que la
// pestaña Pedidos vuelve a pesar 123 kB en vez de 78 y nadie se entera hasta
// que alguien vuelva a medir el bundle a mano.
//
// El otro lado es peor y sí se ve: seis de los once diálogos se quedan
// montados con `open` en false para poder animar su salida. Si al cerrarse se
// desmontaran, el diálogo desaparecería de golpe.

/** Un componente perezoso que avisa cuándo se lo pidió de verdad. */
function moduloDePrueba() {
    const cargar = vi.fn(async () => ({
        default: ({ open }) => <div data-testid="dialogo">{open ? 'abierto' : 'cerrado'}</div>,
    }));
    return { cargar, Dialogo: dialogoDiferido(cargar) };
}

const pintar = async (ui) => {
    const r = render(ui);
    // El `lazy()` resuelve en una microtarea; sin esto se mide antes de tiempo.
    await act(async () => {});
    return r;
};

describe('dialogoDiferido', () => {
    it('con open=false NO pide el trozo — que es todo el punto', async () => {
        const { cargar, Dialogo } = moduloDePrueba();
        await pintar(<Dialogo open={false} />);
        expect(cargar).not.toHaveBeenCalled();
        expect(screen.queryByTestId('dialogo')).toBeNull();
    });

    it('lo pide recién al abrirse', async () => {
        const { cargar, Dialogo } = moduloDePrueba();
        const { rerender } = await pintar(<Dialogo open={false} />);
        expect(cargar).not.toHaveBeenCalled();

        rerender(<Dialogo open />);
        await act(async () => {});
        expect(cargar).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('dialogo')).toHaveTextContent('abierto');
    });

    it('al cerrarse SIGUE montado: lo necesita para animar su salida', async () => {
        const { Dialogo } = moduloDePrueba();
        const { rerender } = await pintar(<Dialogo open />);
        expect(screen.getByTestId('dialogo')).toHaveTextContent('abierto');

        rerender(<Dialogo open={false} />);
        await act(async () => {});
        // Sigue en el DOM, y con `open` en false — que es lo que el diálogo
        // mira para irse con su animación.
        expect(screen.getByTestId('dialogo')).toHaveTextContent('cerrado');
    });

    it('sin prop `open` se monta enseguida: el sitio ya decidió con un `&&`', async () => {
        const { cargar, Dialogo } = moduloDePrueba();
        await pintar(<Dialogo />);
        expect(cargar).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('dialogo')).toBeInTheDocument();
    });

    it('pasa las props al diálogo de verdad', async () => {
        const cargar = vi.fn(async () => ({
            default: ({ numero }) => <p data-testid="n">{numero}</p>,
        }));
        const Dialogo = dialogoDiferido(cargar);
        await pintar(<Dialogo open numero="A-42" />);
        expect(screen.getByTestId('n')).toHaveTextContent('A-42');
    });
});
