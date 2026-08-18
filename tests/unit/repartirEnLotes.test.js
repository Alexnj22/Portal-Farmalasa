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

    it('el mismo número con otro vencimiento es OTRO lote: la fecha desempata', () => {
        // Hay productos con dos lotes de igual número y fechas distintas: son
        // existencias separadas.
        const lotes = [
            { id: '1', numero: 'X1', vence: '2027-01-01', stock: 10 },
            { id: '2', numero: 'X1', vence: '2028-01-01', stock: 10 },
        ];
        const r = repartirEnLotes(lotes, 1, 10, [{ numero: 'X1', vence: '2028-01-01', paquetes: 1 }]);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '2', lote: 'X1' }]);
        expect(r.avisos).toEqual([]);
    });

    // ── El número manda; la fecha sólo desempata ─────────────────────────────
    // Quien pide ve la fecha del inventario del portal y quien despacha la del
    // <select> de traslados: son dos pantallas distintas del sistema. Si la
    // coincidencia exacta de fecha fuera obligatoria, un día distinto tiraría
    // abajo una reserva correcta y el lote elegido se perdería en silencio.
    it('un número único se respeta aunque la fecha no coincida', () => {
        const r = repartirEnLotes(ALOPURINOL, 1, 10, [{ numero: '6F125', vence: '2030-06-30', paquetes: 1 }]);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '102', lote: '6F125' }]);
        expect(r.avisos).toEqual([]);
    });

    it('un número único se respeta aunque la solicitud no traiga fecha', () => {
        const r = repartirEnLotes(ALOPURINOL, 1, 10, [{ numero: '6F125', paquetes: 1 }]);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '102', lote: '6F125' }]);
    });

    it('número repetido y ninguna fecha que coincida: sale el que vence primero y se avisa', () => {
        const lotes = [
            { id: '1', numero: 'X1', vence: '2027-01-01', stock: 10 },
            { id: '2', numero: 'X1', vence: '2028-01-01', stock: 10 },
        ];
        const r = repartirEnLotes(lotes, 1, 10, [{ numero: 'X1', vence: '2029-12-31', paquetes: 1 }]);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '1', lote: 'X1' }]);
        expect(r.avisos.join(' ')).toMatch(/hay dos lotes X1/);
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

// ── La reserva ORDENA, no LIMITA ────────────────────────────────────────────
// El mismo desacuerdo entre el tope y el reparto que motivó este archivo,
// entrando por la otra puerta: acá los lotes SÍ alcanzaban y el reparto los
// cerraba después de sacarles menos de lo que tenían.
//
// Los dos casos son reales y están medidos — DOLO APRANAX X 100 TAB (id 1271),
// presentación BLÍSTER X 10, el 2026-08-18. Los dos pedían 4 blísteres y los dos
// contestaron «faltan 1» sobre existencia suficiente.
describe('repartirEnLotes — la reserva ordena, no limita', () => {
    /** Salud 5 → Salud 2. El portal reservó 15 unidades de LH2504902; el sistema tiene 20. */
    const APRANAX_S5 = [
        { id: '1', numero: 'GENERICO', vence: '2025-12-31', stock: 5 },
        { id: '2', numero: 'LI2408201', vence: '2027-08-01', stock: 20 },
        { id: '3', numero: 'LH2504902', vence: '2028-07-01', stock: 20 },
    ];

    /** Salud 2 → Salud 3. El portal reservó 39 unidades de J2502102; el sistema tiene 40. */
    const APRANAX_S2 = [
        { id: '4', numero: 'D2505802', vence: '2028-03-01', stock: 1 },
        { id: '5', numero: 'J2502102', vence: '2028-09-01', stock: 40 },
    ];

    it('vuelve al lote reservado por lo que le sobra (Salud 5 → Salud 2)', () => {
        // La reserva llega en unidades y se redondea lote por lote: 5→0, 20→2,
        // 15→1 = 3 blísteres, y hacen falta 4. El cuarto está en LH2504902, que
        // tiene 20 y sólo dio 10.
        const r = repartirEnLotes(APRANAX_S5, 4, 10, [
            { numero: 'GENERICO', vence: '2025-12-31', paquetes: 0 },
            { numero: 'LI2408201', vence: '2027-08-01', paquetes: 2 },
            { numero: 'LH2504902', vence: '2028-07-01', paquetes: 1 },
        ]);
        expect(r.faltan).toBe(0);
        expect(r.renglones.map(x => [x.lote, x.cantidad])).toEqual([['LI2408201', 2], ['LH2504902', 2]]);
        expect(r.avisos.join(' ')).toMatch(/LH2504902 salieron 1 más de lo que la solicitud había reservado/);
    });

    it('un lote = un renglón, aunque se vuelva a él (Salud 2 → Salud 3)', () => {
        // Dos renglones del mismo lote son la misma existencia contada dos veces.
        const r = repartirEnLotes(APRANAX_S2, 4, 10, [
            { numero: 'D2505802', vence: '2028-03-01', paquetes: 0 },
            { numero: 'J2502102', vence: '2028-09-01', paquetes: 3 },
        ]);
        expect(r.faltan).toBe(0);
        expect(r.renglones).toEqual([{ cantidad: 4, idLote: '5', lote: 'J2502102' }]);
    });

    it('lo que el tope promete, el reparto lo entrega — con reserva y sin ella', () => {
        // El invariante, no un número escrito a mano: es lo único que impide que
        // las dos mitades vuelvan a discrepar por una tercera puerta.
        for (const lotes of [APRANAX_S5, APRANAX_S2, ALOPURINOL]) {
            const hay = disponibleEnBodega(
                { regulado: true, lotes, existencia: 0, presentaciones: [], vence: '', encontrado: true },
                10,
            );
            // La reserva más adversa: un paquete de cada lote, que es la que
            // toca todos y no completa ninguno.
            const reserva = lotes.map(l => ({ numero: l.numero, vence: l.vence, paquetes: 1 }));
            expect(repartirEnLotes(lotes, hay.paquetes, 10, reserva).faltan).toBe(0);
            expect(repartirEnLotes(lotes, hay.paquetes, 10).faltan).toBe(0);
        }
    });

    it('sigue sin despachar más de lo pedido al volver sobre un lote', () => {
        const r = repartirEnLotes(APRANAX_S2, 2, 10, [{ numero: 'J2502102', paquetes: 1 }]);
        expect(r.renglones.reduce((s, x) => s + x.cantidad, 0)).toBe(2);
        expect(r.faltan).toBe(0);
    });

    it('el aviso distingue volver al lote reservado de salir por otro', () => {
        const otro = repartirEnLotes(ALOPURINOL, 2, 10, [{ numero: '6A096', paquetes: 1 }]);
        expect(otro.avisos.join(' ')).toMatch(/no es el que la solicitud había reservado/);
        // 3 cajas con la reserva pidiendo 1 de 6F125: sale esa, después la
        // única de 6A096 —que vence primero— y la tercera vuelve a 6F125.
        const mismo = repartirEnLotes(ALOPURINOL, 3, 10, [{ numero: '6F125', paquetes: 1 }]);
        expect(mismo.renglones.map(x => [x.lote, x.cantidad])).toEqual([['6F125', 2], ['6A096', 1]]);
        expect(mismo.avisos.join(' ')).toMatch(/6F125 salieron 1 más de lo que la solicitud había reservado/);
    });

    it('el sujeto del aviso lo pone quien llama', () => {
        const r = repartirEnLotes(ALOPURINOL, 2, 10, [{ numero: 'FANTASMA', paquetes: 2 }], 'el pedido');
        expect(r.avisos.join(' ')).toMatch(/que reservó el pedido ya no está/);
        expect(r.avisos.join(' ')).toMatch(/no es el que el pedido había reservado/);
    });
});
