// Cada cobro de crédito del portal, junto al renglón que la caja anotó por él.
//
// Se prueba porque el modo de falla no da error y suena a fraude: son el MISMO
// dinero, y sin emparejar la pantalla muestra $17.90 dos veces sobre un cobro
// de $17.90. En una lista de dinero eso no es un detalle de presentación.
//
// Los datos son los reales del 2 y 3 de septiembre de 2026 — Salud 3 (27) y
// Salud 4 (28).

import { describe, it, expect } from 'vitest';
import { emparejarCobrosConMovimientos } from '../../src/utils/cortesDiagnostico';
import { cobroEnEfectivo } from '../../src/data/creditos';

const emparejar = (m, c) => emparejarCobrosConMovimientos(m, c, cobroEnEfectivo);

const mov = (id, branch_id, monto, o = {}) => ({
    id, branch_id, fecha: '2026-09-02', monto: String(monto),
    concepto: 'POR ABONO A CREDITO', tipo: 'ENTRADA', ...o,
});

const cobro = (id, branch_id, monto, o = {}) => ({
    id, branch_id, monto: String(monto), forma: 'Efectivo',
    cliente: 'ALGUIEN', credito_erp: '2288', anulado_at: null,
    created_at: '2026-09-02T18:00:00+00:00', ...o,
});

describe('emparejarCobrosConMovimientos', () => {
    /* Salud 4, 2-sep: los tres cobros en efectivo del portal aparecieron como
     * «POR ABONO A CREDITO» y los dos por transferencia no. Es el caso normal. */
    it('cruza cada cobro en efectivo con su renglón de la caja', () => {
        const movs = [mov(1, 28, 8.55), mov(2, 28, 79.70), mov(3, 28, 1.30)];
        const cobros = [
            cobro(2, 28, 8.55),
            cobro(4, 28, 79.70),
            cobro(7, 28, 1.30),
            cobro(1, 28, 11.30, { forma: 'Transferencia' }),
            cobro(3, 28, 10.00, { forma: 'Transferencia' }),
        ];
        const { porMovimiento, sueltos } = emparejar(movs, cobros);
        expect([...porMovimiento.keys()].sort()).toEqual([1, 2, 3]);
        expect(porMovimiento.get(2).id).toBe(4);          // $79.70 con su renglón
        // Los que no son efectivo no entran al cajón: quedan sueltos SIEMPRE, y
        // eso no es un fallo — allá no se anotan nunca.
        expect(sueltos.map((c) => c.id).sort()).toEqual([1, 3]);
        expect(sueltos.every((c) => c.entroAlCajon === false)).toBe(true);
    });

    /* El renglón se usa UNA vez. Sin el uno a uno, dos cobros del mismo monto
     * se colgarían del mismo renglón y el segundo diría «todavía no aparece». */
    it('reparte dos cobros del mismo monto entre los dos renglones', () => {
        const movs = [mov(10, 25, 4.00), mov(11, 25, 4.00)];
        const cobros = [
            cobro(20, 25, 4.00, { created_at: '2026-09-02T18:00:00+00:00' }),
            cobro(21, 25, 4.00, { created_at: '2026-09-02T19:00:00+00:00' }),
        ];
        const { porMovimiento, sueltos } = emparejar(movs, cobros);
        expect(porMovimiento.size).toBe(2);
        expect(sueltos).toHaveLength(0);
        // El más viejo se lleva el primero: el reparto no depende del orden en
        // que vino la lista.
        expect(porMovimiento.get(10).id).toBe(20);
        expect(porMovimiento.get(11).id).toBe(21);
    });

    it('da el mismo reparto viniendo la lista al revés', () => {
        const movs = [mov(10, 25, 4.00), mov(11, 25, 4.00)];
        const cobros = [
            cobro(21, 25, 4.00, { created_at: '2026-09-02T19:00:00+00:00' }),
            cobro(20, 25, 4.00, { created_at: '2026-09-02T18:00:00+00:00' }),
        ];
        const { porMovimiento } = emparejar(movs, cobros);
        expect(porMovimiento.get(10).id).toBe(20);
        expect(porMovimiento.get(11).id).toBe(21);
    });

    /* La sala y el día acotan: un renglón de Salud 3 no puede explicar un cobro
     * de Salud 4 aunque el monto coincida al centavo. */
    it('no cruza entre salas', () => {
        const { porMovimiento, sueltos } = emparejar([mov(1, 27, 9.05)], [cobro(5, 28, 9.05)]);
        expect(porMovimiento.size).toBe(0);
        expect(sueltos.map((c) => c.id)).toEqual([5]);
    });

    it('no cruza entre días', () => {
        const movs = [mov(1, 27, 9.05, { fecha: '2026-09-01' })];
        const { porMovimiento, sueltos } = emparejar(movs, [cobro(5, 27, 9.05)]);
        expect(porMovimiento.size).toBe(0);
        expect(sueltos).toHaveLength(1);
    });

    /* El día es el de la SALA. Un cobro de las 23:30 de El Salvador son las
     * 05:30 UTC del día siguiente: leído en UTC caería en el día que no es y
     * se quedaría suelto para siempre. */
    it('el día sale de la hora de sala y no del reloj UTC', () => {
        const movs = [mov(1, 27, 12.00, { fecha: '2026-09-02' })];
        const cobros = [cobro(5, 27, 12.00, { created_at: '2026-09-03T05:30:00+00:00' })];
        const { porMovimiento } = emparejar(movs, cobros);
        expect(porMovimiento.get(1)?.id).toBe(5);
    });

    /* Un renglón que NO es un abono no se puede usar para explicar un cobro,
     * por más que el monto dé: «aplicacion» de $1.00 es una inyección. */
    it('sólo mira los renglones de abono', () => {
        const movs = [mov(1, 27, 1.00, { concepto: 'aplicacion inyeccion' })];
        const { porMovimiento, sueltos } = emparejar(movs, [cobro(5, 27, 1.00)]);
        expect(porMovimiento.size).toBe(0);
        expect(sueltos).toHaveLength(1);
    });

    /* Un cobro anulado no movió dinero: colgarle el cliente a un renglón que sí
     * lo movió diría que ese dinero es de una deuda que nadie pagó. */
    it('un cobro anulado no se queda con ningún renglón', () => {
        const movs = [mov(1, 27, 9.05)];
        const cobros = [
            cobro(5, 27, 9.05, { anulado_at: '2026-09-02T20:00:00+00:00' }),
            cobro(6, 27, 9.05, { created_at: '2026-09-02T21:00:00+00:00' }),
        ];
        const { porMovimiento, sueltos } = emparejar(movs, cobros);
        expect(porMovimiento.get(1).id).toBe(6);
        expect(sueltos.map((c) => c.id)).toEqual([5]);
    });

    /* Un cobro en efectivo suelto es lo que hay que poder ver: o la captura
     * todavía no pasó, o allá no se anotó. Se distingue del de transferencia
     * por `entroAlCajon`, no por el hecho de estar suelto. */
    it('distingue el efectivo suelto del que no toca el cajón', () => {
        const cobros = [
            cobro(5, 27, 17.90),
            cobro(6, 27, 10.07, { forma: 'Transferencia' }),
        ];
        const { sueltos } = emparejar([], cobros);
        expect(sueltos.find((c) => c.id === 5).entroAlCajon).toBe(true);
        expect(sueltos.find((c) => c.id === 6).entroAlCajon).toBe(false);
    });

    /* Un cobro con tarjeta que SÍ aparece en la caja no es imposible: significa
     * que el origen lo trató como efectivo, y el corte lo va a pedir en
     * billetes. Se empareja igual —es el mismo dinero— y `entroAlCajon` sigue
     * diciendo la verdad de la forma de pago. */
    it('empareja un cobro que no es efectivo si el renglón existe', () => {
        const movs = [mov(1, 27, 534.63)];
        const cobros = [cobro(6, 27, 534.63, { forma: 'Transferencia' })];
        const { porMovimiento } = emparejar(movs, cobros);
        expect(porMovimiento.get(1).id).toBe(6);
        expect(porMovimiento.get(1).entroAlCajon).toBe(false);
    });

    /* Salud 3 el 3-sep-2026, tal como quedó en producción: cuatro cobros del
     * portal en cinco minutos, dos en efectivo y dos por transferencia, y la
     * captura trajo exactamente dos renglones de abono. Es el caso que trajo
     * todo esto —el usuario cobró y no lo vio en ninguna pantalla— y por eso
     * queda anclado con los datos reales. */
    it('reproduce Salud 3 del 3-sep: dos emparejados y dos que no tocan el cajón', () => {
        const movs = [
            mov(41, 27, 2.00, { fecha: '2026-09-03' }),
            mov(42, 27, 17.90, { fecha: '2026-09-03' }),
            mov(43, 27, 40.00, { fecha: '2026-09-03', concepto: 'P26 Otro', tipo: 'SALIDA' }),
        ];
        const cobros = [
            cobro(12, 27, 17.90, { cliente: 'CELINA BEATRIZ ESCOBAR ESCOBAR', credito_erp: '2288', created_at: '2026-09-03T16:57:29.119776+00:00' }),
            cobro(11, 27, 2.00,  { cliente: 'CELINA BEATRIZ ESCOBAR ESCOBAR', credito_erp: '2414', created_at: '2026-09-03T16:57:14.909570+00:00' }),
            cobro(10, 27, 10.07, { cliente: 'MAPFRE SEGURO EL SALVADOR, S.A.', forma: 'Transferencia', created_at: '2026-09-03T16:56:43.890042+00:00' }),
            cobro(9,  27, 35.57, { cliente: 'MAPFRE SEGURO EL SALVADOR, S.A.', forma: 'Transferencia', created_at: '2026-09-03T16:55:55.071816+00:00' }),
        ];
        const { porMovimiento, sueltos } = emparejar(movs, cobros);
        expect(porMovimiento.get(41).id).toBe(11);      // $2.00
        expect(porMovimiento.get(42).id).toBe(12);      // $17.90
        expect(porMovimiento.has(43)).toBe(false);      // la salida de $40 no es un abono
        expect(sueltos.map((c) => c.id)).toEqual([9, 10]);
        expect(sueltos.every((c) => c.entroAlCajon === false)).toBe(true);
    });

    it('sin cobros no toca nada', () => {
        const { porMovimiento, sueltos } = emparejar([mov(1, 27, 9.05)], []);
        expect(porMovimiento.size).toBe(0);
        expect(sueltos).toHaveLength(0);
    });
});
