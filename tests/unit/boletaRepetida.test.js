import { describe, it, expect } from 'vitest';
import { choqueDeBoleta } from '../../src/utils/boletaRepetida';

// ═══════════════════════════════════════════════════════════════════════════
// Ese número de boleta ya está anotado en la sala. ¿Y entonces?
//
// El número de una boleta de POS es el ID de la transacción: el aparato no lo
// repite nunca. Dos movimientos con el mismo número en la misma sala hablan
// SIEMPRE de la misma operación — pero eso puede ser dos cosas distintas, y
// tratarlas igual rompe una de las dos:
//
//   · mismo sentido   → duplicado. Costó $377.61 en doce días.
//   · sentido opuesto → corrección. Alguien anotó una remesa como ingreso
//                       (una remesa SALE del cajón) y la contra-anotó.
//                       Frenarla dejaría sin salida a quien ya se equivocó.
// ═══════════════════════════════════════════════════════════════════════════

const ENTRADA = { id: 214, tipo: 'ENTRADA', monto: 12.30, concepto: 'Pago de CAESS' };
const SALIDA = { id: 679, tipo: 'SALIDA', monto: 100, concepto: 'Remesa TRANSNETWORK WS' };

describe('choqueDeBoleta', () => {
    it('sin repetidas no hay nada que decir', () => {
        expect(choqueDeBoleta([], true)).toBeNull();
        expect(choqueDeBoleta(null, true)).toBeNull();
        expect(choqueDeBoleta(undefined, false)).toBeNull();
    });

    it('anotar un ingreso cuando ya hay un ingreso con ese número: FRENA', () => {
        // Es el caso de Salud 2 del 5-sep: $12.30 de CAESS, dos entradas con la
        // boleta 000467, separadas por 634 ms, las dos vigentes.
        const r = choqueDeBoleta([ENTRADA], true);
        expect(r).toEqual({ bloquea: true, movimiento: ENTRADA });
    });

    it('anotar una salida cuando ya hay una salida con ese número: FRENA', () => {
        const r = choqueDeBoleta([SALIDA], false);
        expect(r.bloquea).toBe(true);
        expect(r.movimiento).toBe(SALIDA);
    });

    it('anotar una salida cuando lo que hay es un ingreso: avisa y DEJA', () => {
        // La corrección real: se anotó como entrada algo que era remesa, y se
        // contra-anota como salida. Ver boletas 000514, 000449, 000513.
        const r = choqueDeBoleta([ENTRADA], false);
        expect(r).toEqual({ bloquea: false, movimiento: ENTRADA });
    });

    it('anotar un ingreso cuando lo que hay es una salida: avisa y DEJA', () => {
        const r = choqueDeBoleta([SALIDA], true);
        expect(r.bloquea).toBe(false);
    });

    it('con una de cada una, gana el DUPLICADO', () => {
        // Si ya hubo corrección y alguien vuelve a anotar el ingreso, lo que
        // hay que decir es «esto ya está», no «esto parece una corrección».
        const r = choqueDeBoleta([SALIDA, ENTRADA], true);
        expect(r.bloquea).toBe(true);
        expect(r.movimiento).toBe(ENTRADA);
    });

    it('el sentido se compara sin importar mayúsculas', () => {
        expect(choqueDeBoleta([{ tipo: 'entrada' }], true).bloquea).toBe(true);
    });

    it('una fila sin sentido no frena por las dudas', () => {
        // Preferir el aviso al bloqueo cuando el dato no alcanza: frenar de más
        // deja a alguien sin poder anotar con el cliente enfrente.
        const r = choqueDeBoleta([{ id: 9, tipo: null }], true);
        expect(r.bloquea).toBe(false);
    });
});
