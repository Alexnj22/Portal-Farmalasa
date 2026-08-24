import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCapturaDeCarne from '../../src/hooks/useCapturaDeCarne';

/**
 * Lo que el lector manda y lo que el portal entiende.
 *
 * Estas pruebas nacieron de un reporte que sobrevivió a un arreglo: «el escáner
 * con el lector aún no funciona, con la cámara sí». Cada una ancla una de las
 * formas en que una ráfaga real se pierde **sin dejar rastro** — que es lo que
 * hace que el defecto se vea igual que un lector desconectado.
 */

const tecla = (init) => new KeyboardEvent('keydown', { bubbles: true, ...init });

function escanear(teclas, { gap = 5 } = {}) {
    for (const t of teclas) {
        act(() => { document.dispatchEvent(tecla(t)); });
        vi.advanceTimersByTime(gap);
    }
}

/** Cierra la ráfaga dejando vencer el plazo de fin (500 ms). */
const dejarVencer = () => act(() => { vi.advanceTimersByTime(600); });

describe('la captura del lector', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('entrega una ráfaga que termina sin Enter cuando la pantalla lo acepta', () => {
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(true, alLeer, { aceptarTecleado: true, sinEnter: true }));

        escanear([{ key: '3' }, { key: '2' }, { key: '2' }, { key: '7' }, { key: '8' }]);
        expect(alLeer).not.toHaveBeenCalled();   // todavía puede llegar más
        dejarVencer();

        expect(alLeer).toHaveBeenCalledWith('32278');
    });

    it('sin `sinEnter`, la misma ráfaga se descarta — es el candado del carné', () => {
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(true, alLeer));

        escanear([{ key: '3' }, { key: '2' }, { key: '2' }, { key: '7' }, { key: '8' }]);
        dejarVencer();

        expect(alLeer).not.toHaveBeenCalled();
    });

    it('lee un lector que no dice `key` y deja la identidad en `code`', () => {
        // Hay capas de emulación de teclado que entregan `key: "Unidentified"`.
        // Con el filtro por `key` a secas, la ráfaga se descartaba ENTERA.
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(true, alLeer, { aceptarTecleado: true, sinEnter: true }));

        escanear([
            { key: 'Unidentified', code: 'Digit3' },
            { key: 'Unidentified', code: 'Numpad2' },
            { key: 'Unidentified', code: 'Digit2' },
            { key: 'Unidentified', code: 'Digit7' },
            { key: 'Unidentified', code: 'KeyA' },
        ]);
        dejarVencer();

        expect(alLeer).toHaveBeenCalledWith('322 7A'.replace(' ', ''));
    });

    it('no convierte un modificador en carácter', () => {
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(true, alLeer, { aceptarTecleado: true, sinEnter: true }));

        escanear([
            { key: 'Shift', code: 'ShiftLeft' },
            { key: 'Unidentified', code: 'Digit1' },
            { key: 'Unidentified', code: 'Digit2' },
            { key: 'Unidentified', code: 'Digit3' },
        ]);
        dejarVencer();

        expect(alLeer).toHaveBeenCalledWith('123');
    });

    it('cuenta las teclas que llegaron y no se pudieron interpretar', () => {
        // El caso que hay que poder DISTINGUIR de un lector desconectado: manda,
        // pero nada de lo que manda se puede leer. Sin esta cuenta, la pantalla
        // se ve exactamente igual en los dos casos.
        const alLeer = vi.fn();
        const { result } = renderHook(() =>
            useCapturaDeCarne(true, alLeer, { aceptarTecleado: true, sinEnter: true }));

        escanear([
            { key: 'Unidentified', code: 'Lang1' },
            { key: 'Unidentified', code: 'Lang1' },
            { key: 'Unidentified', code: 'Lang1' },
        ]);
        dejarVencer();

        expect(alLeer).not.toHaveBeenCalled();
        expect(result.current.diagnostico).toMatchObject({ teclas: 0, ignoradas: 3 });
    });

    it('el diagnóstico dice si la ráfaga vino lenta, y NO guarda el texto de un carné', () => {
        const alLeer = vi.fn();
        const { result } = renderHook(() => useCapturaDeCarne(true, alLeer));

        escanear([{ key: '1' }, { key: '2' }, { key: '3' }], { gap: 200 });
        dejarVencer();

        expect(alLeer).not.toHaveBeenCalled();
        expect(result.current.diagnostico.texto).toBeNull();
        expect(result.current.diagnostico.huecoMax).toBeGreaterThan(80);
    });

    it('apagada no escucha nada', () => {
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(false, alLeer, { aceptarTecleado: true, sinEnter: true }));

        escanear([{ key: '1' }, { key: '2' }, { key: '3' }]);
        dejarVencer();

        expect(alLeer).not.toHaveBeenCalled();
    });
});

describe('la cuenta cruda de teclas', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('cuenta TODA tecla, incluso las que ningún filtro deja pasar', () => {
        // Es la afirmación que cierra el caso: si acá sale 0 después de
        // escanear, el navegador no está recibiendo nada y el problema deja de
        // ser del portal. Por eso se cuenta antes de cualquier filtro.
        const { result } = renderHook(() =>
            useCapturaDeCarne(true, vi.fn(), { aceptarTecleado: true, sinEnter: true }));

        escanear([
            { key: 'Escape' },
            { key: 'Shift', code: 'ShiftLeft' },
            { key: 'Unidentified', code: 'Lang1' },
            { key: '7' },
        ]);

        expect(result.current.eventos).toBe(4);
    });

    it('lee un lector que PEGA el código en vez de teclearlo', () => {
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(true, alLeer, { aceptarTecleado: true, sinEnter: true }));

        act(() => {
            const e = new Event('paste', { bubbles: true });
            e.clipboardData = { getData: () => '  32278 ' };
            document.dispatchEvent(e);
        });

        expect(alLeer).toHaveBeenCalledWith('32278');
    });

    it('un pegado NO vale donde el código es una credencial', () => {
        const alLeer = vi.fn();
        renderHook(() => useCapturaDeCarne(true, alLeer));   // sin `aceptarTecleado`

        act(() => {
            const e = new Event('paste', { bubbles: true });
            e.clipboardData = { getData: () => 'ABCD1234' };
            document.dispatchEvent(e);
        });

        expect(alLeer).not.toHaveBeenCalled();
    });
});
