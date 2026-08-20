import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// «Me solicitan 3 pero solo puedo mandar 2 porque ya vendí 1 ahorita.»
//
// Eso es lo que decide esta tarjeta, y por eso se prueba: hasta el 2026-08-20
// la única salida era rechazar entero —comparaba contra lo pedido completo y
// empujaba al rechazo—, y ahora se puede mandar lo que hay.
//
// Los cuatro casos son los cuatro que se pueden romper por separado:
//
//  1. **Alcanza todo** — el camino normal no puede pedir explicaciones ni
//     cambiar de viaje: se despacha de un botón y viaja `null`, igual que antes
//     de que el despacho parcial existiera.
//  2. **Alcanza menos** — la casilla trae la respuesta puesta, y el botón NO
//     deja mandar hasta que se diga por qué. Un despacho a medias sin motivo es
//     una caja incompleta que llega sin explicación.
//  3. **No alcanza nada** — no hay cantidad que elegir: la única salida es
//     rechazar, con el motivo que corresponde ya elegido.
//  4. **Escribir de más** — el tope es lo pedido. Del lado del servidor también
//     se topa; acá se prueba que la pantalla no proponga un número que el
//     servidor va a tener que corregir.
//
// Las dos escalas son la trampa de todo el archivo: la existencia viene en
// unidades BASE y lo pedido en PAQUETES de la presentación. `factor` las une.
// ═══════════════════════════════════════════════════════════════════════════

const despacharTraslado = vi.fn(async () => ({ ok: true }));
const rechazarTraslado = vi.fn(async () => ({ error: null }));
let disponibilidad = null;

vi.mock('../../src/data/traslados', () => ({
    MOTIVOS_RECHAZO: ['Producto ya encargado', 'Sin existencia en físico', 'Producto dañado', 'Otro'],
    fetchDisponibilidadTraslado: vi.fn(async () => ({ disponibilidad, error: null })),
    despacharTraslado: (...a) => despacharTraslado(...a),
    recibirTraslado: vi.fn(),
    rechazarTraslado: (...a) => rechazarTraslado(...a),
}));

const { DecisionTraslado } = await import('../../src/views/traslados/FilasTraslado.jsx');

// Una solicitud de 3 CAJAS de 10, o sea 30 unidades base.
const FILA = {
    id: 'sol-1',
    metadata: {
        items: [{
            erp_product_id: 2724,
            descripcion: 'ALOPURINOL 300 MG',
            presentacion_tipo: 'CAJA',
            factor: 10,
            cantidad: 3,
        }],
    },
};

/** La respuesta del servidor, con la existencia en unidades BASE. */
const conExistencia = (unidades, extra = {}) => ({
    pedido: 30,
    origen: { erp_sucursal_id: 2, vencidos: false, unidades, en_vuelo: 0, minimo: 0, puede: unidades >= 30 },
    respaldo: null,
    alternativas: [],
    lineas: [{
        idx: 0,
        erp_product_id: 2724,
        descripcion: 'ALOPURINOL 300 MG',
        pedido: 30,
        unidades,
        en_vuelo: 0,
        minimo: 0,
        puede: unidades >= 30,
        alternativas: [],
        ...extra,
    }],
});

const pintar = async () => {
    const onHecho = vi.fn();
    await act(async () => { render(<DecisionTraslado fila={FILA} onHecho={onHecho} />); });
    return onHecho;
};

const casilla = () => screen.getByLabelText(/Cuántos envías de ALOPURINOL/i);

beforeEach(() => {
    despacharTraslado.mockClear();
    rechazarTraslado.mockClear();
});

describe('cuando alcanza todo', () => {
    beforeEach(() => { disponibilidad = conExistencia(50); });

    it('la casilla viene en lo pedido y no pide explicaciones', async () => {
        await pintar();
        expect(casilla().value).toBe('3');
        expect(screen.queryByPlaceholderText('¿Por qué no sale todo?')).toBeNull();
        expect(screen.getByRole('button', { name: /Confirmar y enviar/i })).not.toBeDisabled();
    });

    // El camino normal tiene que hacer EXACTAMENTE el mismo viaje que antes de
    // que el despacho parcial existiera: `null` es «sale todo lo pedido».
    it('despacha sin mandar recorte ni motivo', async () => {
        await pintar();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Confirmar y enviar/i }));
        });
        expect(despacharTraslado).toHaveBeenCalledWith('sol-1', '', null);
    });
});

describe('cuando alcanza menos de lo que piden', () => {
    // 20 unidades base = 2 cajas de 10. Piden 3.
    beforeEach(() => { disponibilidad = conExistencia(20); });

    it('la casilla trae puesto lo que sí se puede mandar', async () => {
        await pintar();
        expect(casilla().value).toBe('2');
        expect(screen.getByText(/alcanza para 2/)).toBeTruthy();
    });

    it('no deja despachar hasta decir por qué no sale todo', async () => {
        await pintar();
        const boton = screen.getByRole('button', { name: /Enviar lo que hay/i });
        expect(boton).toBeDisabled();

        await act(async () => {
            fireEvent.change(screen.getByPlaceholderText('¿Por qué no sale todo?'),
                { target: { value: 'Se vendió una hace un rato' } });
        });
        expect(screen.getByRole('button', { name: /Enviar lo que hay/i })).not.toBeDisabled();
    });

    it('manda el renglón por su ÍNDICE, con la cantidad y el motivo', async () => {
        await pintar();
        await act(async () => {
            fireEvent.change(screen.getByPlaceholderText('¿Por qué no sale todo?'),
                { target: { value: 'Se vendió una hace un rato' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Enviar lo que hay/i }));
        });
        expect(despacharTraslado).toHaveBeenCalledWith(
            'sol-1', 'Se vendió una hace un rato', [{ i: 0, cantidad: 2 }],
        );
    });

    // Vaciar la casilla no es «mandar cero»: no hay nada que despachar, y el
    // botón tiene que decirlo apagándose en vez de mandar una caja vacía.
    it('con la casilla vacía no se puede despachar', async () => {
        await pintar();
        await act(async () => { fireEvent.change(casilla(), { target: { value: '' } }); });
        expect(screen.getByRole('button', { name: /Confirmar y enviar|Enviar lo que hay/i })).toBeDisabled();
    });
});

describe('cuando no alcanza nada', () => {
    beforeEach(() => {
        disponibilidad = conExistencia(0, { alternativas: [{ erp_sucursal_id: 3, sala: 'Salud 3', unidades: 40, minimo: 0 }] });
    });

    it('no ofrece despachar: pasa al rechazo con el motivo ya elegido', async () => {
        await pintar();
        expect(screen.queryByRole('button', { name: /Confirmar y enviar|Enviar lo que hay/i })).toBeNull();
        expect(screen.getByRole('button', { name: /Rechazar/i })).not.toBeDisabled();
        expect(screen.getByText(/Ya no puedes enviarlo/)).toBeTruthy();
    });

    it('le sugiere a quien pidió dónde sí hay', async () => {
        await pintar();
        expect(screen.getByText(/Se le va a sugerir/)).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rechazar/i })); });
        expect(rechazarTraslado).toHaveBeenCalledWith(
            'sol-1', 'Sin existencia en físico', '', 'Sí hay en Salud 3 (40)',
        );
    });
});

describe('el tope es lo pedido', () => {
    beforeEach(() => { disponibilidad = conExistencia(500); });

    // No da error en ninguna parte: sale en la caja. El servidor lo topa
    // igual, pero la pantalla no puede proponer un número que va a tener que
    // corregirse del otro lado.
    it('escribir 30 donde piden 3 despacha 3', async () => {
        await pintar();
        await act(async () => { fireEvent.change(casilla(), { target: { value: '30' } }); });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Confirmar y enviar/i }));
        });
        expect(despacharTraslado).toHaveBeenCalledWith('sol-1', '', null);
    });
});
