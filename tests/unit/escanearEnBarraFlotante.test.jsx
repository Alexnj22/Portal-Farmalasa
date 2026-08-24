// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BarraFlotante from '../../src/components/common/BarraFlotante';

/**
 * El botón de escanear tiene que sobrevivir al `blur` del campo vacío.
 *
 * ── El bug (2026-08-24, reportado desde iOS) ──────────────────────────────
 * «Veo el ícono, al tocarlo no hace nada, no me abre nada.» Y era literal: el
 * botón vive DENTRO del bloque que `onBlur` desmonta cuando el campo está
 * vacío —que es justo cuando se escanea, sin haber escrito nada—, así que la
 * secuencia real de un toque lo borraba antes de que el `click` aterrizara:
 *
 *     pointerdown → blur del input → setBuscando(false) → el bloque se
 *     desmonta → el click ya no tiene botón sobre el cual caer.
 *
 * Es la MISMA trampa que el archivo ya documentaba 250 líneas más arriba para
 * el botón de la lupa («`blur` llega ANTES que `click`»); el de escanear se
 * agregó en v2.712.0 y quedó fuera de esa protección. La ✕ se salvaba por
 * casualidad: sólo se dibuja con texto, y con texto el guard no cierra.
 *
 * ── Por qué el orden de los `fireEvent` ES la prueba ──────────────────────
 * `userEvent.click` no reproduce el blur —en jsdom el foco no se mueve solo al
 * tocar un `<button>`—, así que un click a secas pasaba con el código roto. La
 * afirmación exige disparar la secuencia del navegador a mano, y comprobar que
 * el botón sigue montado DESPUÉS del blur: eso es lo que fallaba.
 */

const mostrarBarraFlotante = () => {
    // `useLayoutCompacto`: sin esto `BarraFlotante` devuelve null y el test
    // pasaría en verde sin haber pintado nada.
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: true, media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    globalThis.IntersectionObserver = class {
        observe() {} unobserve() {} disconnect() {}
    };
    globalThis.ResizeObserver = class {
        observe() {} unobserve() {} disconnect() {}
    };
};

const abrirElCampo = () => fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

describe('BarraFlotante · escanear', () => {
    beforeEach(mostrarBarraFlotante);

    it('con el campo VACÍO, el toque llega al botón de escanear', () => {
        const alEscanear = vi.fn();
        render(<BarraFlotante buscador={{ value: '', onChange: vi.fn(), alEscanear }} />);

        abrirElCampo();
        const boton = screen.getByRole('button', { name: 'Escanear un código de barras' });

        // La secuencia real de un toque, en su orden real.
        fireEvent.pointerDown(boton);
        fireEvent.blur(screen.getByRole('textbox'));

        // Lo que fallaba: acá el bloque entero se desmontaba.
        expect(screen.queryByRole('button', { name: 'Escanear un código de barras' })).not.toBeNull();

        fireEvent.click(boton);
        expect(alEscanear).toHaveBeenCalledTimes(1);
    });

    it('sin tocar el botón, el campo vacío SIGUE cerrándose al perder el foco', () => {
        render(<BarraFlotante buscador={{ value: '', onChange: vi.fn(), alEscanear: vi.fn() }} />);

        abrirElCampo();
        fireEvent.blur(screen.getByRole('textbox'));

        // El guard no se desactivó: sin marca de escaneo, cerrar el campo vacío
        // al perder el foco es el comportamiento que ya existía.
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('la marca se consume: el siguiente blur vuelve a cerrar', () => {
        const alEscanear = vi.fn();
        render(<BarraFlotante buscador={{ value: '', onChange: vi.fn(), alEscanear }} />);

        abrirElCampo();
        const boton = screen.getByRole('button', { name: 'Escanear un código de barras' });
        fireEvent.pointerDown(boton);
        fireEvent.blur(screen.getByRole('textbox'));
        fireEvent.click(boton);

        // Segundo blur, ya sin toque al botón: la marca no puede quedar pegada,
        // o el campo no se cerraría nunca más.
        fireEvent.blur(screen.getByRole('textbox'));
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('sin `alEscanear` no se dibuja el botón', () => {
        render(<BarraFlotante buscador={{ value: '', onChange: vi.fn() }} />);
        abrirElCampo();
        expect(screen.queryByRole('button', { name: 'Escanear un código de barras' })).toBeNull();
    });
});
