import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import usePaginaEnUrl from '../../src/hooks/usePaginaEnUrl';

// ═══════════════════════════════════════════════════════════════════════════
// La página de una tabla vive en la dirección.
//
// Pedido del usuario, 2026-08-22, contando inventario:
//
//   «imagina que estoy haciendo el conteo y estoy en la página 50, y se me
//    actualiza, me devuelve a la página 1»
//
// El modo de falla es el silencio: nada explota, la tabla se pinta perfecta y
// la única señal es que quien está frente al anaquel tiene que buscar de nuevo
// dónde iba entre 1,400 productos. Por eso hace falta anclarlo con pruebas —
// una regresión acá se vería exactamente igual que el arreglo.
//
// Las cuatro cosas que se rompen por separado:
//
//  1. **Leer la dirección.** `?pag=50` tiene que dar 50, y una dirección sucia
//     (`?pag=abc`, `?pag=0`, `?pag=-3`) tiene que dar 1 y no NaN — un NaN
//     viajaría como `p_offset` a la RPC.
//  2. **El tamaño se valida contra la lista blanca.** Va a la RPC como
//     `p_limit`: un `?ver=99999` escrito a mano pediría una página que PostgREST
//     recorta a 1000 filas SIN error ni aviso.
//  3. **Reemplaza, no empuja.** Con `push`, salir de una vista tras recorrer 50
//     páginas costaría 50 toques de «atrás».
//  4. **La corrección de rango espera al total.** Antes de la primera respuesta
//     el total vale 0; si el hook corrigiera ahí, un enlace con `?pag=50` se
//     caería a la 1 antes de que llegara la lista — o sea rompiendo justo lo
//     que vino a arreglar.
// ═══════════════════════════════════════════════════════════════════════════

let ultimo = null;
let atras = null;

function Sonda({ total = null }) {
    const api = usePaginaEnUrl({ total });
    const location = useLocation();
    const navigate = useNavigate();
    ultimo = api;
    atras = () => navigate(-1);
    return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

// Una vista cualquiera de la que se viene: es lo que tiene que aparecer al
// apretar «atrás» UNA vez, sin importar cuántas páginas se hayan recorrido.
function DeDondeVengo() {
    const location = useLocation();
    return <span data-testid="url">{location.pathname}</span>;
}

function montar(inicial, props = {}) {
    return render(
        <MemoryRouter initialEntries={['/inventario', inicial]} initialIndex={1}>
            <Routes>
                <Route path="/inventario" element={<DeDondeVengo />} />
                <Route path="/conteo/:id" element={<Sonda {...props} />} />
            </Routes>
        </MemoryRouter>,
    );
}

const url = () => screen.getByTestId('url').textContent;

describe('usePaginaEnUrl', () => {
    beforeEach(() => { cleanup(); ultimo = null; atras = null; });

    it('lee la página y el tamaño de la dirección', () => {
        montar('/conteo/abc?pag=50&ver=100');
        expect(ultimo.page).toBe(50);
        expect(ultimo.pageSize).toBe(100);
    });

    it('una dirección sucia cae al default, nunca a NaN', () => {
        for (const sucia of ['?pag=abc', '?pag=0', '?pag=-3', '?pag=', '']) {
            cleanup();
            montar(`/conteo/abc${sucia}`);
            expect(ultimo.page).toBe(1);
            expect(Number.isInteger(ultimo.page)).toBe(true);
        }
    });

    it('el tamaño fuera de la lista blanca NO se acepta — iría como p_limit a la RPC', () => {
        for (const tam of ['99999', '1000', '7', 'cien']) {
            cleanup();
            montar(`/conteo/abc?ver=${tam}`);
            expect(ultimo.pageSize).toBe(25);
        }
        // Y los tres que sí existen entran tal cual.
        for (const tam of [25, 50, 100]) {
            cleanup();
            montar(`/conteo/abc?ver=${tam}`);
            expect(ultimo.pageSize).toBe(tam);
        }
    });

    it('cambiar de página REEMPLAZA: un solo «atrás» sale de la vista', () => {
        montar('/conteo/abc');
        act(() => { ultimo.setPage(2); });
        act(() => { ultimo.setPage(3); });
        act(() => { ultimo.setPage(4); });
        expect(url()).toBe('/conteo/abc?pag=4');
        // Lo que de verdad importa: recorrer páginas no apila historial. Con
        // `push`, salir tras 50 páginas costaría 50 toques.
        const volver = atras;
        act(() => { volver(); });
        expect(url()).toBe('/inventario');
    });

    it('la página 1 no ensucia el enlace', () => {
        montar('/conteo/abc?pag=7');
        act(() => { ultimo.setPage(1); });
        expect(url()).toBe('/conteo/abc');
    });

    it('cambiar el tamaño vuelve a la página 1 en UNA sola escritura', () => {
        montar('/conteo/abc?pag=40');
        act(() => { ultimo.setPageSize(100); });
        expect(url()).toBe('/conteo/abc?ver=100');
        expect(ultimo.page).toBe(1);
        expect(ultimo.pageSize).toBe(100);
    });

    it('resetPage borra la posición y deja el resto de la dirección', () => {
        montar('/conteo/abc?pag=12&ver=50&tab=productos');
        act(() => { ultimo.resetPage(); });
        expect(url()).toContain('ver=50');
        expect(url()).toContain('tab=productos');
        expect(url()).not.toContain('pag=');
    });

    it('NO corrige la página mientras el total todavía es 0', () => {
        // Es el caso del arranque: la dirección dice 50 y la lista no llegó.
        montar('/conteo/abc?pag=50', { total: 0 });
        expect(ultimo.page).toBe(50);
        expect(url()).toBe('/conteo/abc?pag=50');
    });

    it('corrige a la última página real cuando el total ya se sabe', () => {
        montar('/conteo/abc?pag=50', { total: 60 });   // 60 filas / 25 = 3 páginas
        expect(ultimo.totalPages).toBe(3);
        expect(url()).toBe('/conteo/abc?pag=3');
        expect(ultimo.page).toBe(3);
    });

    it('una lista de una sola página deja la dirección limpia', () => {
        montar('/conteo/abc?pag=9', { total: 10 });
        expect(ultimo.totalPages).toBe(1);
        expect(url()).toBe('/conteo/abc');
    });

    it('una página dentro de rango no se toca', () => {
        montar('/conteo/abc?pag=2', { total: 60 });
        expect(ultimo.page).toBe(2);
        expect(url()).toBe('/conteo/abc?pag=2');
    });
});
