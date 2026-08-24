// El borrador que se OFRECE, para el formulario que edita algo que ya existe.
//
// `UnifiedModal` encendió el borrador sólo para los dos tipos que son un alta, y
// dejó escrita la razón de no hacerlo al editar:
//
//   > «NO cuando se está EDITANDO una ya registrada: ahí la fila de la base es
//   > la verdad.»
//
// Ese razonamiento es correcto y sigue en pie — reponer sobre un registro vivo
// puede escribir datos viejos encima de lo que otra persona cambió en el medio,
// y nadie lo notaría. Lo que faltaba era el camino del medio: **guardar sin
// reponer**, y preguntar al reabrir. La fila de la base sigue siendo la verdad
// hasta que alguien decida otra cosa a la vista de las dos.
//
// Lo que este archivo ancla es justamente lo que separa un camino del otro:
//
//   · **la hora tiene que estar** — lo que decide a una persona no es «hay un
//     borrador», es «hay uno de hace diez minutos». Sin la hora, aceptar es una
//     apuesta;
//   · **caduca a las 24 h**, así que lo que se ofrece nunca es de anteayer;
//   · y `descartar()` tiene que dejar de ofrecerlo **y** borrarlo, porque un
//     ofrecimiento que vuelve después de rechazarlo es peor que no tenerlo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, renderHook, act, fireEvent } from '@testing-library/react';
import AvisoDeBorrador from '../../src/components/common/AvisoDeBorrador';
import useBorrador from '../../src/hooks/useBorrador';
import { saveDraft, loadDraft, loadDraftTime } from '../../src/utils/draftUtils';

beforeEach(() => localStorage.clear());

describe('la hora del borrador', () => {
    it('se puede leer, aunque `loadDraft` no la devuelva', () => {
        // `loadDraft` se come el `ts` a propósito: quien repuebla no lo
        // necesita. Quien OFRECE, sí.
        saveDraft('x', { a: 1 });
        expect(loadDraft('x')).toEqual({ a: 1 });
        expect(loadDraftTime('x')).toBeTypeOf('number');
    });

    it('sin borrador no inventa una hora', () => {
        expect(loadDraftTime('no-existe')).toBeNull();
    });

    it('comparte la caducidad de 24 h con `loadDraft`', () => {
        // Es lo que acota el riesgo entero de esta función: lo que se ofrece
        // nunca puede ser de anteayer.
        localStorage.setItem('pedido_draft_viejo',
            JSON.stringify({ ts: Date.now() - 25 * 3600_000, data: { a: 1 } }));
        expect(loadDraftTime('viejo')).toBeNull();
        expect(loadDraft('viejo')).toBeNull();
    });

    it('un `localStorage` corrupto no revienta', () => {
        localStorage.setItem('pedido_draft_roto', 'no es json');
        expect(loadDraftTime('roto')).toBeNull();
    });
});

describe('el hook devuelve cuándo se guardó', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('junto con lo recuperado', () => {
        saveDraft('x', { nombre: 'Ana' });
        const { result } = renderHook(() => useBorrador('x', {}));
        expect(result.current.recuperado).toEqual({ nombre: 'Ana' });
        expect(result.current.cuando).toBeTypeOf('number');
    });

    it('sin borrador, la hora es nula y no cero', () => {
        // Un 0 es una fecha válida (1970) y se pintaría como «hace 56 años».
        const { result } = renderHook(() => useBorrador('x', {}));
        expect(result.current.cuando).toBeNull();
    });

    it('al descartar se va la hora también', () => {
        saveDraft('x', { nombre: 'Ana' });
        const { result } = renderHook(() => useBorrador('x', {}));
        act(() => result.current.descartar());
        expect(result.current.recuperado).toBeNull();
        expect(result.current.cuando).toBeNull();
    });

    it('al cambiar de registro trae la hora del NUEVO', () => {
        // Es lo que evita ofrecer el borrador de una sucursal sobre otra.
        saveDraft('sucursal_7', { a: 1 });
        const { result, rerender } = renderHook(({ k }) => useBorrador(k, {}),
                                                { initialProps: { k: 'sucursal_9' } });
        expect(result.current.cuando).toBeNull();
        rerender({ k: 'sucursal_7' });
        expect(result.current.cuando).toBeTypeOf('number');
    });
});

describe('el aviso que se le muestra a la persona', () => {
    it('dice desde cuándo, en minutos', () => {
        render(<AvisoDeBorrador cuando={Date.now() - 12 * 60_000}
                                onRecuperar={() => {}} onDescartar={() => {}} />);
        expect(screen.getByRole('status').textContent).toMatch(/hace 12 minutos/);
    });

    it('en horas cuando ya no son minutos', () => {
        render(<AvisoDeBorrador cuando={Date.now() - 3 * 3600_000}
                                onRecuperar={() => {}} onDescartar={() => {}} />);
        expect(screen.getByRole('status').textContent).toMatch(/hace 3 horas/);
    });

    it('y pasa a la hora del reloj cuando «hace N horas» obliga a hacer la cuenta', () => {
        // A las nueve de la mañana, «hace 14 horas» no dice «anoche» — hay que
        // restarlo mentalmente.
        render(<AvisoDeBorrador cuando={Date.now() - 14 * 3600_000}
                                onRecuperar={() => {}} onDescartar={() => {}} />);
        expect(screen.getByRole('status').textContent).toMatch(/a las/);
    });

    it('sin hora sigue avisando, en vez de callarse', () => {
        // Si la hora falta, lo que NO puede pasar es que el aviso desaparezca:
        // ahí lo escrito se perdería en silencio, que es el defecto original.
        render(<AvisoDeBorrador cuando={null} onRecuperar={() => {}} onDescartar={() => {}} />);
        expect(screen.getByRole('status').textContent).toMatch(/cambios sin guardar/);
    });

    it('ofrece las DOS salidas, y la de descartar tiene nombre', () => {
        // Un botón de sólo ícono sin nombre se anuncia como «botón» (WCAG 4.1.2).
        render(<AvisoDeBorrador cuando={Date.now()} onRecuperar={() => {}} onDescartar={() => {}} />);
        expect(screen.getByRole('button', { name: /recuperar/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /descartar/i })).toBeTruthy();
    });

    it('cada botón llama a lo suyo', () => {
        const recuperar = vi.fn(), descartar = vi.fn();
        render(<AvisoDeBorrador cuando={Date.now()} onRecuperar={recuperar} onDescartar={descartar} />);
        fireEvent.click(screen.getByRole('button', { name: /recuperar/i }));
        expect(recuperar).toHaveBeenCalledTimes(1);
        expect(descartar).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
        expect(descartar).toHaveBeenCalledTimes(1);
    });

    it('informa, no interrumpe: `role="status"`, nunca `alert`', () => {
        // `alert` obliga al lector de pantalla a cortar lo que esté leyendo, y
        // esto no es un error: es una oferta.
        render(<AvisoDeBorrador cuando={Date.now()} onRecuperar={() => {}} onDescartar={() => {}} />);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('sin nada que ofrecer no dibuja nada', () => {
        const { container } = render(<AvisoDeBorrador cuando={Date.now()} />);
        expect(container.innerHTML).toBe('');
    });
});
