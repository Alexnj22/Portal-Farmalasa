import { describe, it, expect } from 'vitest';
import { repartirEnLotes, disponibleEnBodega } from '../../supabase/functions/_shared/erp-traslado.ts';

// De qué lotes sale un traslado.
//
// **Estas pruebas existen porque lo que decide este código es cuánto
// medicamento sale de una sala y de qué lote.** Un paquete de más no da error:
// sale en la caja. Un paquete de menos tampoco: la sala que lo pidió se queda
// esperando y nadie sabe por qué.
//
// El caso que las motivó es real y está medido: el 2026-08-18 Bodega no pudo
// mandar 6 cajas de ALOPURINOL 300 (id 2724) que tenía en dos lotes —6A096 con
// 1 caja y 6F125 con 5, presentación CAJA de 10—, porque el reparto exigía que
// UN lote tuviera las 60 unidades juntas. La solicitud terminó rechazada a
// mano.
//
// Las dos escalas son la trampa de todo el archivo: `stock` va en unidades
// BASE, el pedido y los renglones en PAQUETES, y `unidad` es el factor. Cada
// prueba dice en cuál está cada número.

/** Los dos lotes de ALOPURINOL 300 en Bodega, tal como estaban ese día. */
const ALOPURINOL = [
    { id: '101', numero: '6A096', vence: '2030-01-01', stock: 10 },   // 1 caja
    { id: '102', numero: '6F125', vence: '2030-06-01', stock: 50 },   // 5 cajas
];

describe('repartirEnLotes — el caso que lo destapó', () => {
    it('arma las 6 cajas con los dos lotes', () => {
        const r = repartirEnLotes(ALOPURINOL, 6, 10);
        expect(r.faltan).toBe(0);
        // Vence primero el 6A096, así que sale primero y completo.
        expect(r.renglones).toEqual([
            { cantidad: 1, idLote: '101', lote: '6A096' },
            { cantidad: 5, idLote: '102', lote: '6F125' },
        ]);
    });

    it('el tope y el reparto dicen lo mismo', () => {
        // Es la regla que se rompió: `disponibleEnBodega` contaba lote por lote
        // y decía «alcanza para 6», y el reparto contestaba que no había.
        const hay = disponibleEnBodega(
            { regulado: true, lotes: ALOPURINOL, existencia: 10, presentaciones: [], vence: '', encontrado: true },
            10,
        );
        expect(hay.paquetes).toBe(6);
        expect(repartirEnLotes(ALOPURINOL, hay.paquetes, 10).faltan).toBe(0);
    });
});

describe('repartirEnLotes — el que vence primero sale primero', () => {
    it('no toca el segundo lote si el primero alcanza', () => {
        const r = repartirEnLotes(ALOPURINOL, 1, 10);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '101', lote: '6A096' }]);
    });

    it('ordena por vencimiento y no por el orden de la pantalla', () => {
        // El sistema no garantiza el orden de la lista — medido el 2026-08-14,
        // dos lotes del mismo producto salieron en distinto orden en dos
        // consultas del mismo día.
        const alReves = [...ALOPURINOL].reverse();
        expect(repartirEnLotes(alReves, 6, 10).renglones[0].lote).toBe('6A096');
    });

    it('un lote sin fecha va al final, no al principio', () => {
        const lotes = [
            { id: '1', numero: 'SIN', vence: '', stock: 100 },
            { id: '2', numero: 'CON', vence: '2027-01-01', stock: 100 },
        ];
        expect(repartirEnLotes(lotes, 1, 10).renglones[0].lote).toBe('CON');
    });
});

describe('repartirEnLotes — las dos escalas', () => {
    it('un lote que no completa un paquete no aporta', () => {
        // 9 unidades con presentación de 10: no hay caja que armar. Es el mismo
        // criterio de `disponibleEnBodega`, que hace `floor(stock/unidad)`.
        const lotes = [
            { id: '1', numero: 'A', vence: '2027-01-01', stock: 9 },
            { id: '2', numero: 'B', vence: '2027-02-01', stock: 30 },
        ];
        const r = repartirEnLotes(lotes, 3, 10);
        expect(r.faltan).toBe(0);
        expect(r.renglones).toEqual([{ cantidad: 3, idLote: '2', lote: 'B' }]);
    });

    it('con presentación de 1, paquete y unidad son lo mismo', () => {
        const lotes = [{ id: '1', numero: 'A', vence: '2027-01-01', stock: 7 }];
        expect(repartirEnLotes(lotes, 7, 1).renglones).toEqual([
            { cantidad: 7, idLote: '1', lote: 'A' },
        ]);
    });
});

describe('repartirEnLotes — lo que falta se dice, no se completa solo', () => {
    it('devuelve `faltan` en paquetes y no inventa renglones', () => {
        const r = repartirEnLotes(ALOPURINOL, 8, 10);
        expect(r.faltan).toBe(2);
        // Lo que sí había queda armado: quien llama decide si corta.
        expect(r.renglones.reduce((s, x) => s + x.cantidad, 0)).toBe(6);
    });

    it('sin lotes, falta todo', () => {
        expect(repartirEnLotes([], 3, 10)).toMatchObject({ faltan: 3, renglones: [] });
    });

    it('ignora los lotes en cero', () => {
        const lotes = [{ id: '1', numero: 'A', vence: '2027-01-01', stock: 0 }];
        expect(repartirEnLotes(lotes, 1, 10).faltan).toBe(1);
    });
});

describe('repartirEnLotes — los lotes que la solicitud reservó MANDAN', () => {
    // Decisión del usuario, 2026-08-07: quien pide ve los lotes y descarta los
    // que no quiere; el despacho saca de ésos.
    it('respeta la reserva aunque no sea la que vence primero', () => {
        const r = repartirEnLotes(ALOPURINOL, 2, 10, [{ numero: '6F125', vence: '2030-06-01', paquetes: 2 }]);
        expect(r.renglones).toEqual([{ cantidad: 2, idLote: '102', lote: '6F125' }]);
        expect(r.avisos).toEqual([]);
    });

    it('reparte igual que la reserva cuando la reserva cubre todo', () => {
        const r = repartirEnLotes(ALOPURINOL, 6, 10, [
            { numero: '6A096', paquetes: 1 },
            { numero: '6F125', paquetes: 5 },
        ]);
        expect(r.renglones.map(x => [x.lote, x.cantidad])).toEqual([['6A096', 1], ['6F125', 5]]);
        expect(r.avisos).toEqual([]);
    });

    it('un lote reservado que ya no está NO corta: avisa y lo cubre el otro', () => {
        // Frenar acá sería frenar mercadería que sigue en el estante — mismo
        // criterio que el pedido (decisión del usuario, 2026-08-11).
        const r = repartirEnLotes(ALOPURINOL, 2, 10, [{ numero: 'FANTASMA', paquetes: 2 }]);
        expect(r.faltan).toBe(0);
        // 6A096 tiene una sola caja, así que las 2 salen de los dos lotes.
        expect(r.renglones.map(x => [x.lote, x.cantidad])).toEqual([['6A096', 1], ['6F125', 1]]);
        expect(r.avisos.join(' ')).toMatch(/FANTASMA.*ya no está/);
        expect(r.avisos.join(' ')).toMatch(/no es el que la solicitud había reservado/);
    });

    it('el mismo número con otro vencimiento es OTRO lote', () => {
        // Hay productos con dos lotes de igual número y fechas distintas: son
        // existencias separadas.
        const lotes = [
            { id: '1', numero: 'X1', vence: '2027-01-01', stock: 10 },
            { id: '2', numero: 'X1', vence: '2028-01-01', stock: 10 },
        ];
        const r = repartirEnLotes(lotes, 1, 10, [{ numero: 'X1', vence: '2028-01-01', paquetes: 1 }]);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '2', lote: 'X1' }]);
    });

    it('la reserva no alcanza a completar lo pedido: se avisa y se completa', () => {
        const r = repartirEnLotes(ALOPURINOL, 6, 10, [{ numero: '6A096', paquetes: 6 }]);
        expect(r.faltan).toBe(0);
        expect(r.renglones.map(x => [x.lote, x.cantidad])).toEqual([['6A096', 1], ['6F125', 5]]);
        expect(r.avisos.join(' ')).toMatch(/solo alcanzaban 1/);
    });

    it('nunca despacha más de lo pedido, aunque la reserva diga más', () => {
        const r = repartirEnLotes(ALOPURINOL, 2, 10, [{ numero: '6F125', paquetes: 5 }]);
        expect(r.renglones.reduce((s, x) => s + x.cantidad, 0)).toBe(2);
    });

    it('no usa dos veces el mismo lote', () => {
        const r = repartirEnLotes(ALOPURINOL, 6, 10, [
            { numero: '6A096', paquetes: 1 },
            { numero: '6A096', paquetes: 1 },
        ]);
        const ids = r.renglones.map(x => x.idLote);
        expect(new Set(ids).size).toBe(ids.length);
        expect(r.faltan).toBe(0);
    });

    it('el número del lote se compara sin importar espacios ni mayúsculas', () => {
        const r = repartirEnLotes(ALOPURINOL, 1, 10, [{ numero: ' 6f125 ', paquetes: 1 }]);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '102', lote: '6F125' }]);
    });
});
