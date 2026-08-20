import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// Las hermanas de una misma solicitud, juntas — y el botón de recibirlas todas.
//
// Pedido del usuario, 2026-08-20: *«debo poder confirmar por cada sala, y si
// todas las salas contestaron confirmar completo»*.
//
// Lo que estas pruebas anclan son las dos condiciones que se aceptaron junto con
// ese botón, porque las dos se pierden solas:
//
//  1. **Sólo cuando ya contestaron todas.** Con una sala todavía sin responder,
//     «recibir todo» sería recibir un todo que aún no está.
//  2. **De una en una por dentro.** Cada recepción es un viaje al sistema de
//     origen con su propia sesión; si una falla, las anteriores YA quedaron y se
//     reintenta sólo esa. Lo contrario —darlas todas por perdidas— haría cargar
//     dos veces el producto que sí entró.
//
// Y la tercera, que no es de este archivo pero sí de este botón: lo que
// confirma tiene que estar A LA VISTA. Por eso el botón va debajo de las
// tarjetas y las tarjetas son `children`.
// ═══════════════════════════════════════════════════════════════════════════

const recibirTraslado = vi.fn(async () => ({ ok: true }));

vi.mock('../../src/data/traslados', () => ({
    recibirTraslado: (...a) => recibirTraslado(...a),
}));

const GrupoPorRecibir = (await import('../../src/views/traslados/GrupoPorRecibir.jsx')).default;

const fila = (id, sala) => ({ id, metadata: { origen_branch_name: sala } });

const pintar = (grupo, filas, onHecho = vi.fn()) => {
    render(
        <GrupoPorRecibir grupo={grupo} filas={filas} onHecho={onHecho}>
            <div>tarjetas</div>
        </GrupoPorRecibir>,
    );
    return onHecho;
};

const boton = () => screen.queryByRole('button', { name: /Ya llegaron/ });

beforeEach(() => { recibirTraslado.mockClear(); recibirTraslado.mockResolvedValue({ ok: true }); });

describe('el encabezado cuenta lo que la lista no puede', () => {
    // Las que no contestaron NO están en la lista —es de lo que ya salió—, así
    // que sin el estado del grupo el encabezado no podría decir que faltan.
    it('dice cuántas faltan cuando alguna no ha respondido', () => {
        pintar({ total: 3, sinResponder: 1, rechazadas: 0 }, [fila('a', 'Salud 1'), fila('b', 'Salud 2')]);
        expect(screen.getByText(/2 de 3 respondieron · 1 sin responder/)).toBeTruthy();
    });

    it('dice que respondieron todas cuando no falta ninguna', () => {
        pintar({ total: 2, sinResponder: 0, rechazadas: 0 }, [fila('a', 'Salud 1'), fila('b', 'Salud 2')]);
        expect(screen.getByText(/las 2 respondieron/)).toBeTruthy();
    });

    // Un rechazo es una respuesta: la sala contestó que no puede. Se nombra
    // aparte porque «respondieron» a secas se leería como que viene en camino.
    it('nombra las que no pudieron mandarlo', () => {
        pintar({ total: 3, sinResponder: 0, rechazadas: 1 }, [fila('a', 'Salud 1'), fila('b', 'Salud 2')]);
        expect(screen.getByText(/1 no pudo mandarlo/)).toBeTruthy();
    });
});

describe('cuándo aparece el botón de recibirlas todas', () => {
    it('con todas respondidas y más de una esperando, sí', () => {
        pintar({ total: 2, sinResponder: 0, rechazadas: 0 }, [fila('a', 'Salud 1'), fila('b', 'Salud 2')]);
        expect(boton()).toBeTruthy();
    });

    it('con una sala sin responder, NO: sería recibir un todo que no está', () => {
        pintar({ total: 3, sinResponder: 1, rechazadas: 0 }, [fila('a', 'Salud 1'), fila('b', 'Salud 2')]);
        expect(boton()).toBeNull();
    });

    // Con una sola caja el botón de su tarjeta hace exactamente lo mismo, y dos
    // botones que hacen lo mismo obligan a preguntarse en qué se diferencian.
    it('con una sola caja esperando, NO', () => {
        pintar({ total: 2, sinResponder: 0, rechazadas: 1 }, [fila('a', 'Salud 1')]);
        expect(boton()).toBeNull();
    });
});

describe('recibirlas todas', () => {
    it('las recibe de una en una, en orden', async () => {
        const onHecho = pintar(
            { total: 2, sinResponder: 0, rechazadas: 0 },
            [fila('a', 'Salud 1'), fila('b', 'Salud 2')],
        );
        await act(async () => { fireEvent.click(boton()); });

        expect(recibirTraslado.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
        expect(onHecho).toHaveBeenCalled();
    });

    // Lo que NO puede pasar: que un fallo en la segunda haga perder la primera.
    // Ya entró al inventario; darla por no recibida la cargaría dos veces.
    it('si una falla, las anteriores quedan y se dice cuál fue', async () => {
        recibirTraslado
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, error: 'el sistema no contestó' });

        const onHecho = pintar(
            { total: 2, sinResponder: 0, rechazadas: 0 },
            [fila('a', 'Salud 1'), fila('b', 'Salud 2')],
        );
        await act(async () => { fireEvent.click(boton()); });

        expect(recibirTraslado).toHaveBeenCalledTimes(2);
        expect(screen.getByText(/Entraron 1 de 2/)).toBeTruthy();
        expect(screen.getByText(/Salud 2: el sistema no contestó/)).toBeTruthy();
        // Se recarga igual: una entró, y la lista tiene que reflejarlo.
        expect(onHecho).toHaveBeenCalled();
    });

    it('si falla la primera no se intenta la segunda ni se recarga', async () => {
        recibirTraslado.mockResolvedValue({ ok: false, error: 'sin sesión' });

        const onHecho = pintar(
            { total: 2, sinResponder: 0, rechazadas: 0 },
            [fila('a', 'Salud 1'), fila('b', 'Salud 2')],
        );
        await act(async () => { fireEvent.click(boton()); });

        expect(recibirTraslado).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/Entraron 0 de 2/)).toBeTruthy();
        expect(onHecho).not.toHaveBeenCalled();
    });
});
