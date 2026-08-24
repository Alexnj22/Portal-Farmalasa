// Tres piezas del chasis, y las tres protegen contra un fallo MUDO.
// (El aviso de entorno vive en `entornoDelPortal.test.js`.)
//
//   · `fetchAllRows` es la respuesta del portal al tope de 1000 de PostgREST,
//     que corta sin avisar;
//   · `saveDraft`/`loadDraft` son lo único que hay entre un formulario largo y
//     la sesión que se cierra sola a los 5 minutos;
//   · `clickable` da contrato de teclado a lo que no es un `<button>` — y su
//     primera versión dejó 34 controles alcanzables con teclado y MUERTOS con
//     mouse sin que lo detectara el build, el lint ni ningún gate.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchAllRows } from '../../src/utils/supabaseUtils';
import { saveDraft, loadDraft, clearDraft } from '../../src/utils/draftUtils';
import { clickable } from '../../src/utils/clickable';

describe('paginar hasta agotar la consulta', () => {
    /** Una consulta falsa con `n` filas, que responde por rangos como PostgREST. */
    const conFilas = (n) => {
        const llamadas = [];
        const construir = () => ({
            range: (desde, hasta) => {
                llamadas.push([desde, hasta]);
                const filas = [];
                for (let i = desde; i <= Math.min(hasta, n - 1); i++) filas.push({ i });
                return Promise.resolve({ data: filas, error: null });
            },
        });
        return { construir, llamadas };
    };

    it('una tabla chica se trae en una sola vuelta', async () => {
        const { construir, llamadas } = conFilas(30);
        expect(await fetchAllRows(construir)).toHaveLength(30);
        expect(llamadas).toEqual([[0, 999]]);
    });

    it('4.013 filas llegan las 4.013, no 1.000', async () => {
        // Es el número real del filtro «Receta Médica», que llegaba cortado.
        const { construir, llamadas } = conFilas(4013);
        expect(await fetchAllRows(construir)).toHaveLength(4013);
        expect(llamadas).toHaveLength(5);
    });

    it('exactamente 1.000 obliga a una vuelta MÁS', async () => {
        // Es el borde que hace mudo al tope: una página llena no prueba que no
        // haya más. Parar ahí es exactamente el bug que este helper evita.
        const { construir, llamadas } = conFilas(1000);
        expect(await fetchAllRows(construir)).toHaveLength(1000);
        expect(llamadas).toHaveLength(2);
    });

    it('si falla la PRIMERA página devuelve null, no una lista vacía', async () => {
        // Una lista vacía se ve idéntica a «no hay nada», y el llamador la
        // pintaría como tal.
        const construir = () => ({ range: () => Promise.resolve({ data: null, error: { message: 'x' } }) });
        expect(await fetchAllRows(construir)).toBeNull();
    });

    it('si falla una página POSTERIOR devuelve lo que alcanzó a traer', async () => {
        let vuelta = 0;
        const construir = () => ({
            range: (desde) => {
                if (vuelta++ === 0) return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ i: desde + i })), error: null });
                return Promise.resolve({ data: null, error: { message: 'se cayó' } });
            },
        });
        expect(await fetchAllRows(construir)).toHaveLength(1000);
    });
});

describe('el borrador de un formulario largo', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.useRealTimers());

    it('lo guardado se recupera tal cual', () => {
        saveDraft('pedido-4', { renglones: [{ id: 1, cant: 3 }] });
        expect(loadDraft('pedido-4')).toEqual({ renglones: [{ id: 1, cant: 3 }] });
    });

    it('cada formulario tiene su propio borrador', () => {
        saveDraft('a', { x: 1 });
        saveDraft('b', { x: 2 });
        expect(loadDraft('a')).toEqual({ x: 1 });
        expect(loadDraft('b')).toEqual({ x: 2 });
    });

    it('sin borrador devuelve null, no un objeto vacío', () => {
        // Un `{}` se pintaría como un formulario recuperado y vacío.
        expect(loadDraft('no-existe')).toBeNull();
    });

    it('un borrador de más de 24 horas ya no sirve, y se limpia solo', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-20T10:00:00Z'));
        saveDraft('viejo', { x: 1 });
        vi.setSystemTime(new Date('2026-08-21T10:00:01Z'));
        expect(loadDraft('viejo')).toBeNull();
        vi.setSystemTime(new Date('2026-08-20T10:00:00Z'));
        expect(loadDraft('viejo')).toBeNull();      // ya no está guardado
    });

    it('justo antes de las 24 horas todavía sirve', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-20T10:00:00Z'));
        saveDraft('casi', { x: 1 });
        vi.setSystemTime(new Date('2026-08-21T09:59:59Z'));
        expect(loadDraft('casi')).toEqual({ x: 1 });
    });

    it('limpiarlo lo borra', () => {
        saveDraft('c', { x: 1 });
        clearDraft('c');
        expect(loadDraft('c')).toBeNull();
    });

    it('un borrador corrupto no revienta la pantalla', () => {
        localStorage.setItem('pedido_draft_roto', 'esto no es json');
        expect(loadDraft('roto')).toBeNull();
    });
});

describe('el contrato de teclado de lo que no es un botón', () => {
    it('devuelve el `onClick` ADEMÁS del teclado', () => {
        // La primera versión no lo devolvía y el migrador reemplazó el
        // `onClick={fn}` de cada sitio por el spread: 34 controles quedaron
        // alcanzables con teclado y MUERTOS con mouse. No lo detectó el build,
        // ni el lint, ni el gate — sólo un clic real.
        const fn = vi.fn();
        const props = clickable(fn);
        expect(props.onClick).toBe(fn);
        expect(props.role).toBe('button');
        expect(props.tabIndex).toBe(0);
    });

    it('marca la superficie como interactiva', () => {
        // Sale de acá y no de una lista: la misma línea de JSX es clicable o no
        // según los props, así que un barrido estático clasifica mal por
        // construcción.
        expect(clickable(() => {})).toHaveProperty('data-interactive');
    });

    it('sin handler, o deshabilitado, no promete nada', () => {
        // Un `role="button"` sin acción es peor que nada: anuncia un control
        // que no existe.
        expect(clickable(null)).toEqual({});
        expect(clickable(() => {}, { disabled: true })).toEqual({});
    });

    it('Enter y espacio disparan, y no dejan que la página salte', () => {
        const fn = vi.fn();
        const { onKeyDown } = clickable(fn);
        for (const key of ['Enter', ' ']) {
            const e = { key, target: 1, currentTarget: 1, preventDefault: vi.fn() };
            onKeyDown(e);
            expect(e.preventDefault).toHaveBeenCalled();
        }
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('otra tecla no hace nada', () => {
        const fn = vi.fn();
        clickable(fn).onKeyDown({ key: 'a', target: 1, currentTarget: 1, preventDefault: vi.fn() });
        expect(fn).not.toHaveBeenCalled();
    });

    it('el Enter de un control INTERNO no dispara también al contenedor', () => {
        // Sin la guarda, burbujea hasta acá y se ejecutan las dos acciones.
        const fn = vi.fn();
        const e = { key: 'Enter', target: 'el input', currentTarget: 'la fila', preventDefault: vi.fn() };
        clickable(fn).onKeyDown(e);
        expect(fn).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('el rótulo accesible sólo aparece si se pide', () => {
        expect(clickable(() => {})['aria-label']).toBeUndefined();
        expect(clickable(() => {}, { label: 'Abrir pedido' })['aria-label']).toBe('Abrir pedido');
    });
});
