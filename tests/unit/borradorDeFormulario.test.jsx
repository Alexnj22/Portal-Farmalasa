// El borrador de un formulario largo.
//
// El portal cierra la sesión sola cuando nadie usa la pantalla, y **los de sala
// están en 5 minutos**. Un formulario vive en memoria: cuando la sesión se
// cierra se pierde todo lo escrito y no queda rastro. El aviso «¿Sigues ahí?»
// evita la SORPRESA, no la PÉRDIDA — nadie vuelve a tiempo si se fue diez
// minutos.
//
// El hook existe porque ya está medido qué pasa con una regla que cada llamador
// tiene que repetir: `saveDraft` estaba disponible desde hacía meses y
// `gate:borradores` encontró **24 formularios largos sin usarlo**.
//
// Las dos trampas que este archivo ancla, y que son justo las que se saltan al
// escribirlo a mano:
//
//   · **el primer guardado no puede dispararse al montar** — abrir un
//     formulario vacío borraría el borrador que había;
//   · **lo recuperado es lo de ANTES** — releerlo en cada render devolvería lo
//     que el propio hook acaba de escribir, y «lo de antes» dejaría de existir.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useBorrador from '../../src/hooks/useBorrador';
import { saveDraft, loadDraft } from '../../src/utils/draftUtils';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

const montar = (clave, valor, opciones) =>
    renderHook(({ v }) => useBorrador(clave, v, opciones), { initialProps: { v: valor } });

describe('lo que había guardado de antes', () => {
    it('se devuelve al abrir el formulario', () => {
        saveDraft('nuevo-empleado', { nombre: 'Ana' });
        const { result } = montar('nuevo-empleado', {});
        expect(result.current.recuperado).toEqual({ nombre: 'Ana' });
        expect(result.current.hayBorrador).toBe(true);
    });

    it('sin borrador previo no inventa uno', () => {
        const { result } = montar('nuevo-empleado', {});
        expect(result.current.recuperado).toBeNull();
        expect(result.current.hayBorrador).toBe(false);
    });

    it('NO se actualiza con lo que el propio hook acaba de guardar', () => {
        // Si se releyera, «lo de antes» sería «lo de recién» y la pantalla
        // ofrecería recuperar lo que ya está en el formulario.
        const { result, rerender } = montar('x', {});
        rerender({ v: { nombre: 'Luis' } });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toEqual({ nombre: 'Luis' });     // sí se guardó
        expect(result.current.recuperado).toBeNull();            // y sigue sin haber «uno de antes»
    });
});

describe('el primer guardado NO se dispara al montar', () => {
    it('abrir un formulario vacío no borra el borrador que había', () => {
        // Es la trampa: el valor inicial pisaría lo guardado antes de que la
        // persona escriba una letra.
        saveDraft('x', { nombre: 'Ana' });
        montar('x', {});
        act(() => vi.advanceTimersByTime(2000));
        expect(loadDraft('x')).toEqual({ nombre: 'Ana' });
    });

    it('recién al CAMBIAR el valor se guarda', () => {
        const { rerender } = montar('x', { nombre: '' });
        rerender({ v: { nombre: 'A' } });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toEqual({ nombre: 'A' });
    });
});

describe('el retardo', () => {
    it('no guarda una vez por tecla', () => {
        // Escribir «Ana» son tres renders: guardar en cada uno es escribir en
        // disco por cada letra.
        const { rerender } = montar('x', { nombre: '' });
        rerender({ v: { nombre: 'A' } });
        rerender({ v: { nombre: 'An' } });
        rerender({ v: { nombre: 'Ana' } });
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft('x')).toBeNull();
        act(() => vi.advanceTimersByTime(500));
        expect(loadDraft('x')).toEqual({ nombre: 'Ana' });
    });

    it('el retardo se puede ajustar', () => {
        const { rerender } = montar('x', {}, { retardoMs: 50 });
        rerender({ v: { a: 1 } });
        act(() => vi.advanceTimersByTime(60));
        expect(loadDraft('x')).toEqual({ a: 1 });
    });
});

describe('qué cuenta como «hay algo escrito»', () => {
    it('un formulario con todo vacío NO se guarda', () => {
        // Si se guardara, la próxima apertura diría que hay borrador y ofrecería
        // recuperar la nada.
        const { rerender } = montar('x', { a: '' });
        rerender({ v: { a: '', b: null, c: false, d: [] } });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toBeNull();
    });

    it('un CERO sí cuenta: es un dato que alguien escribió', () => {
        // Es el caso que rompen los `if (!x)` — una cantidad en cero o un id 0.
        const { rerender } = montar('x', {});
        rerender({ v: { cantidad: 0 } });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toEqual({ cantidad: 0 });
    });

    it('una lista con algo cuenta; vacía, no', () => {
        const { rerender } = montar('x', {});
        rerender({ v: { lineas: [] } });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toBeNull();
        rerender({ v: { lineas: [{ id: 1 }] } });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toEqual({ lineas: [{ id: 1 }] });
    });

    it('el criterio se puede reemplazar', () => {
        const { rerender } = montar('x', {}, { vale: () => true });
        rerender({ v: {} });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toEqual({});
    });
});

describe('apagarlo y volver a encenderlo', () => {
    it('con el modal cerrado no guarda nada', () => {
        const { rerender } = renderHook(({ v, activo }) => useBorrador('x', v, { activo }),
                                        { initialProps: { v: {}, activo: false } });
        rerender({ v: { a: 1 }, activo: false });
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toBeNull();
    });

    it('al reabrirse NO pisa lo recuperado con su estado inicial', () => {
        // Sin rearmar la guarda, la segunda apertura guardaría el formulario
        // vacío encima del borrador — que es exactamente lo que el hook existe
        // para evitar.
        saveDraft('x', { nombre: 'Ana' });
        const { rerender } = renderHook(({ v, activo }) => useBorrador('x', v, { activo }),
                                        { initialProps: { v: { nombre: 'Ana' }, activo: true } });
        rerender({ v: {}, activo: false });          // se cierra
        act(() => vi.advanceTimersByTime(1000));
        rerender({ v: {}, activo: true });           // se reabre vacío
        act(() => vi.advanceTimersByTime(1000));
        expect(loadDraft('x')).toEqual({ nombre: 'Ana' });
    });
});

describe('descartar', () => {
    it('borra lo guardado y deja de ofrecerlo', () => {
        saveDraft('x', { nombre: 'Ana' });
        const { result } = montar('x', {});
        act(() => result.current.descartar());
        expect(loadDraft('x')).toBeNull();
        expect(result.current.recuperado).toBeNull();
        expect(result.current.hayBorrador).toBe(false);
    });
});

describe('sin clave el hook está apagado', () => {
    it('no lee ni escribe nada', () => {
        const { result, rerender } = renderHook(({ v }) => useBorrador(null, v),
                                                { initialProps: { v: {} } });
        rerender({ v: { a: 1 } });
        act(() => vi.advanceTimersByTime(1000));
        expect(result.current.recuperado).toBeNull();
        expect(localStorage.length).toBe(0);
    });

    it('al aparecer la clave, lee la suya', () => {
        // Pasa cuando el formulario depende de un id que llega después.
        saveDraft('emp-7', { nombre: 'Ana' });
        const { result, rerender } = renderHook(({ k }) => useBorrador(k, {}),
                                                { initialProps: { k: null } });
        expect(result.current.recuperado).toBeNull();
        rerender({ k: 'emp-7' });
        expect(result.current.recuperado).toEqual({ nombre: 'Ana' });
    });

    it('cada formulario ve SÓLO el suyo', () => {
        saveDraft('emp-7', { nombre: 'Ana' });
        saveDraft('emp-9', { nombre: 'Luis' });
        expect(montar('emp-9', {}).result.current.recuperado).toEqual({ nombre: 'Luis' });
    });
});
