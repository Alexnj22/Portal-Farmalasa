// Los movimientos del día, repartidos por corte.
//
// Pedido del usuario (2026-09-02) sobre la lista de Mi caja: «¿por qué aquí no
// se separan los movimientos por el corte, para saber cuáles ya fueron
// registrados y cuáles están pendientes?».
//
// Se prueba porque el modo de falla no da error: un movimiento en el grupo
// equivocado dice «ya registrado» sobre algo que el próximo corte todavía va a
// medir — y eso es exactamente lo que alguien mira para decidir si su conteo
// debería cuadrar.
//
// Los datos son los reales de Salud 4 del 2-sep-2026.

import { describe, it, expect } from 'vitest';
import { repartirPorCorte } from '../../src/utils/cortesDiagnostico';

const corte = (o) => ({ id: 1, tipo: 'C', estado: 'CONFIRMADO', fecha: '2026-09-02', ...o });
const mov = (hora, clave) => ({ clave, cuando: `2026-09-02T${hora}:00-06:00` });

/* Salud 4, tal como pasó: cinco cortes y sólo el de las 15:02 confirmado. */
const CORTES = [
    corte({ id: 666, hora: '13:00:49', estado: 'DESCARTADO' }),
    corte({ id: 669, hora: '13:09:48', estado: 'DESCARTADO' }),
    corte({ id: 675, hora: '14:11:50', estado: 'DESCARTADO' }),
    corte({ id: 676, hora: '15:01:44', estado: 'DESCARTADO' }),
    corte({ id: 677, hora: '15:02:42', estado: 'CONFIRMADO' }),
];

const MOVS = [
    mov('16:04', 'pos-13'),
    mov('16:03', 'pos-35'),
    mov('15:41', 'remesa-300'),
    mov('14:23', 'pos-40'),
    mov('12:59', 'remesa-50'),
    mov('10:53', 'iny-2'),
    mov('10:33', 'iny-1'),
];

describe('el día de Salud 4, repartido', () => {
    const g = repartirPorCorte(MOVS, CORTES);

    it('son dos grupos: lo pendiente y lo que contó el corte firmado', () => {
        expect(g).toHaveLength(2);
        expect(g[0].corte).toBe(null);
        expect(g[1].corte.hora).toBe('15:02');
    });

    it('lo de después de las 15:02 sigue pendiente', () => {
        expect(g[0].lineas.map((l) => l.clave)).toEqual(['pos-13', 'pos-35', 'remesa-300']);
    });

    it('lo de antes ya lo contó ese corte', () => {
        expect(g[1].lineas.map((l) => l.clave))
            .toEqual(['pos-40', 'remesa-50', 'iny-2', 'iny-1']);
    });
});

describe('sólo un CONFIRMADO corre la línea', () => {
    it('un descartado no cuenta nada: su tramo sigue abierto', () => {
        // Es el mismo criterio de `conTramo`. Si acá se corriera con el
        // descartado de las 14:11, el movimiento de las 14:23 aparecería como
        // «ya registrado» y el próximo corte lo mediría igual.
        const g = repartirPorCorte([mov('14:23', 'x')], [
            corte({ id: 675, hora: '14:11:50', estado: 'DESCARTADO' }),
        ]);
        expect(g).toHaveLength(1);
        expect(g[0].corte).toBe(null);
    });

    it('sin ningún corte firmado, todo el día está pendiente', () => {
        const g = repartirPorCorte(MOVS, CORTES.map((c) => ({ ...c, estado: 'DESCARTADO' })));
        expect(g).toHaveLength(1);
        expect(g[0].lineas).toHaveLength(7);
    });
});

describe('los bordes', () => {
    it('el cierre del día cierra, aunque nazca pendiente', () => {
        // El Z no se confirma —lo rechaza `resolver_corte_caja`— pero después de
        // él no queda nada por medir.
        const g = repartirPorCorte([mov('22:30', 'antes')], [
            corte({ id: 700, tipo: 'Z', estado: 'PENDIENTE', hora: '23:00:00' }),
        ]);
        expect(g[0].corte.tipo).toBe('Z');
    });

    it('un movimiento del mismo segundo que el corte ya lo contó', () => {
        // Al revés quedaría pendiente y aparecería de más en el corte siguiente.
        const g = repartirPorCorte([mov('15:02', 'justo')], [
            corte({ id: 677, hora: '15:02:00', estado: 'CONFIRMADO' }),
        ]);
        expect(g).toHaveLength(1);
        expect(g[0].corte.hora).toBe('15:02');
    });

    it('un día que cruza la medianoche no se desordena', () => {
        // Con horas sueltas, «00:10» se lee antes que «23:59» y el movimiento
        // de la madrugada caería del lado equivocado.
        const g = repartirPorCorte(
            [{ clave: 'madrugada', cuando: '2026-09-03T00:10:00-06:00' }],
            [corte({ id: 1, hora: '23:59:00', estado: 'CONFIRMADO' })],
        );
        expect(g).toHaveLength(1);
        expect(g[0].corte).toBe(null);
    });

    it('sin movimientos no hay grupos vacíos', () => {
        expect(repartirPorCorte([], CORTES)).toEqual([]);
    });
});
