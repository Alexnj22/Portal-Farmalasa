import { describe, it, expect } from 'vitest';
import { elegirLineasAceptadas, loQueNoEntro } from '../../supabase/functions/_shared/lineasAceptadas.ts';

// Cuánto de lo que se pidió sale de verdad.
//
// **Estas pruebas existen porque lo que decide este código es cuánta medicina
// sale de una sala.** El caso que lo motivó es el que reportó el usuario: «me
// solicitan 3 pero solo puedo mandar 2 porque ya vendí 1 ahorita». Hasta
// entonces la única salida era rechazar entero.
//
// Los dos errores que este archivo tiene que hacer imposibles:
//
//  1. **Que salga MÁS de lo pedido.** No da error en ninguna parte: sale en la
//     caja. Un tope invertido, un `Math.max` donde va un `Math.min`, y quien
//     despacha puede mandar 30 donde le pidieron 3.
//  2. **Que un renglón desaparezca sin quedar registrado.** La solicitud sigue
//     diciendo lo que se pidió; si lo que salió no se anota aparte, la
//     diferencia no existe para nadie.
//
// `cantidad` va en PAQUETES de la presentación del renglón. Acá no interviene
// el factor: eso es cosa del reparto por lote, que tiene su propio archivo.

const NADA = 'No quedó ningún producto para despachar.';
const pedidas = (...cantidades) => cantidades.map((cantidad) => ({ cantidad }));

describe('elegirLineasAceptadas — sin recorte', () => {
    it('sin `crudas` sale todo lo pedido, que es como funcionó siempre', () => {
        const { aceptadas, error } = elegirLineasAceptadas(pedidas(3, 5), undefined, NADA);
        expect(error).toBeNull();
        expect(aceptadas).toEqual([{ i: 0, cantidad: 3 }, { i: 1, cantidad: 5 }]);
    });

    it('cualquier cosa que no sea un array se trata como «no dijo nada»', () => {
        for (const basura of [null, 'todo', 42, {}]) {
            const { aceptadas } = elegirLineasAceptadas(pedidas(3), basura, NADA);
            expect(aceptadas).toEqual([{ i: 0, cantidad: 3 }]);
        }
    });
});

describe('elegirLineasAceptadas — el tope es lo pedido', () => {
    it('baja la cantidad cuando se pide menos: 3 pedidas, salen 2', () => {
        const { aceptadas, error } = elegirLineasAceptadas(pedidas(3), [{ i: 0, cantidad: 2 }], NADA);
        expect(error).toBeNull();
        expect(aceptadas).toEqual([{ i: 0, cantidad: 2 }]);
    });

    // El que no puede fallar: pedir más de lo pedido no es un traslado más
    // grande, es otra solicitud — sin el motivo ni la firma de quien la habría
    // pedido. Y no da error en ninguna parte: sale en la caja.
    it('NUNCA sube: piden 3, el cliente dice 30, salen 3', () => {
        const { aceptadas } = elegirLineasAceptadas(pedidas(3), [{ i: 0, cantidad: 30 }], NADA);
        expect(aceptadas).toEqual([{ i: 0, cantidad: 3 }]);
    });

    it('una cantidad negativa no sale: el renglón queda fuera', () => {
        const { aceptadas, error } = elegirLineasAceptadas(
            pedidas(3, 5), [{ i: 0, cantidad: -4 }, { i: 1, cantidad: 5 }], NADA);
        expect(error).toBeNull();
        expect(aceptadas).toEqual([{ i: 1, cantidad: 5 }]);
    });

    // Un `0` es una decisión —«este renglón no sale»— y no «no dijo nada». Con
    // un `||` en vez de `Number.isFinite` se leería como lo segundo y el
    // renglón saldría entero, que es exactamente lo contrario de lo que se
    // pidió.
    it('cantidad cero es «no sale», no «sale todo»', () => {
        const { aceptadas } = elegirLineasAceptadas(
            pedidas(3, 5), [{ i: 0, cantidad: 0 }, { i: 1, cantidad: 1 }], NADA);
        expect(aceptadas).toEqual([{ i: 1, cantidad: 1 }]);
    });

    it('una cantidad ilegible cae en lo pedido, no en cero', () => {
        const { aceptadas } = elegirLineasAceptadas(pedidas(3), [{ i: 0, cantidad: 'dos' }], NADA);
        expect(aceptadas).toEqual([{ i: 0, cantidad: 3 }]);
    });
});

describe('elegirLineasAceptadas — qué índices se aceptan', () => {
    it('acepta la forma vieja: un array de índices a secas sale con lo pedido', () => {
        const { aceptadas } = elegirLineasAceptadas(pedidas(3, 5, 7), [0, 2], NADA);
        expect(aceptadas).toEqual([{ i: 0, cantidad: 3 }, { i: 2, cantidad: 7 }]);
    });

    it('descarta índices repetidos, y gana el primero', () => {
        const { aceptadas } = elegirLineasAceptadas(
            pedidas(9), [{ i: 0, cantidad: 2 }, { i: 0, cantidad: 9 }], NADA);
        expect(aceptadas).toEqual([{ i: 0, cantidad: 2 }]);
    });

    it('descarta lo que no es un índice de la solicitud', () => {
        const { aceptadas } = elegirLineasAceptadas(
            pedidas(3, 5),
            [{ i: 5, cantidad: 1 }, { i: -1, cantidad: 1 }, { i: 1.5, cantidad: 1 }, { i: 1, cantidad: 4 }],
            NADA,
        );
        expect(aceptadas).toEqual([{ i: 1, cantidad: 4 }]);
    });

    it('devuelve los renglones en el orden de la solicitud, no en el que llegaron', () => {
        const { aceptadas } = elegirLineasAceptadas(
            pedidas(1, 2, 3), [{ i: 2, cantidad: 3 }, { i: 0, cantidad: 1 }], NADA);
        expect(aceptadas.map((a) => a.i)).toEqual([0, 2]);
    });
});

describe('elegirLineasAceptadas — quedarse sin nada no es aprobar', () => {
    it('si no queda ningún renglón devuelve el mensaje de quien llama', () => {
        const { aceptadas, error } = elegirLineasAceptadas(pedidas(3), [{ i: 0, cantidad: 0 }], NADA);
        expect(aceptadas).toEqual([]);
        expect(error).toBe(NADA);
    });

    it('un array vacío tampoco es «sale todo»', () => {
        const { error } = elegirLineasAceptadas(pedidas(3), [], NADA);
        expect(error).toBe(NADA);
    });
});

describe('loQueNoEntro — lo que faltó queda escrito', () => {
    it('sin recorte no hay nada parcial', () => {
        const p = pedidas(3, 5);
        const { aceptadas } = elegirLineasAceptadas(p, undefined, NADA);
        expect(loQueNoEntro(p, aceptadas)).toEqual({ ajustados: [], fuera: [], parcial: false });
    });

    it('un renglón con menos cantidad sale como ajustado, no como fuera', () => {
        const p = pedidas(3, 5);
        const { aceptadas } = elegirLineasAceptadas(p, [{ i: 0, cantidad: 2 }, { i: 1, cantidad: 5 }], NADA);
        expect(loQueNoEntro(p, aceptadas)).toEqual({
            ajustados: [{ i: 0, cantidad: 2 }], fuera: [], parcial: true,
        });
    });

    it('un renglón que no sale queda en fuera, no en ajustados', () => {
        const p = pedidas(3, 5);
        const { aceptadas } = elegirLineasAceptadas(p, [{ i: 1, cantidad: 5 }], NADA);
        expect(loQueNoEntro(p, aceptadas)).toEqual({
            ajustados: [], fuera: [0], parcial: true,
        });
    });

    // Las dos listas se arman del mismo cálculo justamente para que esto valga
    // siempre: un renglón está en una o en la otra, nunca en las dos.
    it('ningún renglón cae en las dos listas a la vez', () => {
        const p = pedidas(3, 5, 7);
        const { aceptadas } = elegirLineasAceptadas(p, [{ i: 0, cantidad: 1 }, { i: 2, cantidad: 7 }], NADA);
        const { ajustados, fuera } = loQueNoEntro(p, aceptadas);
        const enAjustados = new Set(ajustados.map((a) => a.i));
        expect(fuera.some((i) => enAjustados.has(i))).toBe(false);
        expect(ajustados.map((a) => a.i)).toEqual([0]);
        expect(fuera).toEqual([1]);
    });
});
