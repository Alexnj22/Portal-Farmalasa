import { describe, it, expect } from 'vitest';
import {
    agruparRondaPorMomento, armarEnvioDeRonda, lecturasSinAccion, marcarTurnoDeLimpieza,
    momentosDelDia, mueblesQueFaltan, resumenDelMomento, salasDeBitacora,
} from '@nucleo/utils/rondaDeBitacora';

const sala = {
    id: 1, nombre: 'Sala', tipo: 'sala_ventas', temp_min: null, temp_max: 30, mide_humedad: true,
    franjas: [
        { clave: 'am', label: 'Mañana', desde: '07:00', hasta: '09:00', estado: 'hecha', lectura: { temperatura: 25 } },
        { clave: 'pm', label: 'Tarde', desde: '13:00', hasta: '15:00', estado: 'abierta' },
    ],
    limpiezas: [{ clave: 't1', label: 'Turno 1', desde: '07:00', hasta: '09:00', estado: 'vencida' }],
    puntos: [{ clave: 'piso' }, { clave: 'vitrina' }],
};
const refri = {
    id: 2, nombre: 'Refri', tipo: 'refrigerador', temp_min: 2, temp_max: 8, mide_humedad: false,
    franjas: [{ clave: 'pm', label: 'Tarde', desde: '13:00', hasta: '15:00', estado: 'abierta' }],
    limpiezas: [],
};

describe('momentosDelDia', () => {
    it('une las franjas por clave, ordenadas, y marca las abiertas', () => {
        const m = momentosDelDia([sala, refri]);
        expect(m.map(x => x.clave)).toEqual(['am', 'pm']);
        expect(m[0].ahora).toBe(false);
        expect(m[1].ahora).toBe(true);
    });
});

describe('resumenDelMomento', () => {
    it('cuenta lecturas y limpiezas del momento', () => {
        const [am, pm] = momentosDelDia([sala, refri]);
        const r1 = resumenDelMomento(am, [sala, refri]);
        expect(r1).toMatchObject({ hechos: 1, vencidos: 1, abiertos: 0, completo: false, tono: 'danger' });
        expect(r1.bloques).toHaveLength(2);
        const r2 = resumenDelMomento(pm, [sala, refri]);
        expect(r2).toMatchObject({ hechos: 0, abiertos: 2, tono: 'warning' });
    });
});

describe('la ronda', () => {
    const pendientes = [
        { clave: '1:lectura:pm', tipo: 'lectura', area: sala, bloque: sala.franjas[1] },
        { clave: '2:lectura:pm', tipo: 'lectura', area: refri, bloque: refri.franjas[0] },
        { clave: '1:limpieza:t1', tipo: 'limpieza', area: sala, bloque: sala.limpiezas[0] },
    ];

    it('agrupa por horario y un momento con algo vencido queda vencido', () => {
        const g = agruparRondaPorMomento(pendientes);
        expect(g.map(x => x.clave)).toEqual(['07:00|09:00', '13:00|15:00']);
        expect(g[0].estado).toBe('vencida');
        expect(g[1].lecturas).toHaveLength(2);
    });

    it('un renglón en blanco no viaja; la humedad sólo si el área la mide', () => {
        const env = armarEnvioDeRonda(pendientes, {
            '1:lectura:pm': { temp: '26.5', hum: '60' },
            '2:lectura:pm': { temp: '', hum: '' },
            '1:limpieza:t1': { ...marcarTurnoDeLimpieza(sala, true), obs: '  ' },
        }, '2026-09-28');
        expect(env).toHaveLength(2);
        expect(env[0]).toMatchObject({ tipo: 'lectura', area_id: 1, franja: 'pm', temperatura: 26.5, humedad: 60, accion: null });
        expect(env[1]).toMatchObject({ tipo: 'limpieza', turno: 't1', observaciones: null });
        expect(env[1].puntos).toEqual([{ clave: 'piso', hecho: true }, { clave: 'vitrina', hecho: true }]);
    });

    it('frena la lectura fuera de rango sin acción', () => {
        expect(lecturasSinAccion(pendientes, { '2:lectura:pm': { temp: '9' } })).toHaveLength(1);
        expect(lecturasSinAccion(pendientes, { '2:lectura:pm': { temp: '9', accion: 'Se ajustó' } })).toHaveLength(0);
        expect(lecturasSinAccion(pendientes, { '2:lectura:pm': { temp: '5' } })).toHaveLength(0);
    });

    it('cuenta los muebles que faltan', () => {
        expect(mueblesQueFaltan(sala, new Set(['piso']))).toBe(1);
        expect(mueblesQueFaltan(sala, marcarTurnoDeLimpieza(sala, true).puntos)).toBe(0);
    });
});

describe('salasDeBitacora', () => {
    it('el libro es sólo de farmacias; el ambiente también de bodegas', () => {
        const b = [{ id: 1, name: 'Salud 1', type: 'FARMACIA' }, { id: 9, name: 'Bodega', type: 'BODEGA' }, { id: 3, name: 'X' }];
        expect(salasDeBitacora(b).map(x => x.value)).toEqual(['1', '9', '3']);
        expect(salasDeBitacora(b, { libro: true }).map(x => x.value)).toEqual(['1', '3']);
    });
});

import { alternarGrupoDePuntos, alternarPunto, gruposDePuntos, rotuloCortoDePunto } from '@nucleo/utils/rondaDeBitacora';

describe('los muebles de la limpieza', () => {
    const puntos = [
        { clave: 'v1', tipo: 'vitrina', label: 'Vitrina 1' }, { clave: 'v2', tipo: 'vitrina', label: 'Vitrina 2' },
        { clave: 'e1', tipo: 'estante', label: 'Estante 1' }, { clave: 'x', tipo: 'raro', label: 'Mesa' },
    ];
    it('agrupa por tipo, con «Otros» al final; con uno solo no hay grupos', () => {
        expect(gruposDePuntos(puntos).map(g => [g.tipo, g.items.length])).toEqual([['vitrina', 2], ['estante', 1], ['otro', 1]]);
        expect(gruposDePuntos([puntos[0]])).toEqual([]);
    });
    it('alterna uno y el grupo entero', () => {
        expect([...alternarPunto(new Set(['v1']), 'v1')]).toEqual([]);
        const vitrinas = puntos.slice(0, 2);
        expect([...alternarGrupoDePuntos(new Set(['v1']), vitrinas)].sort()).toEqual(['v1', 'v2']);
        expect([...alternarGrupoDePuntos(new Set(['v1', 'v2']), vitrinas)]).toEqual([]);
    });
    it('el rótulo corto es el número', () => {
        expect(rotuloCortoDePunto(puntos[1], 'Vitrina')).toBe('2');
        expect(rotuloCortoDePunto(puntos[3], '')).toBe('Mesa');
    });
});

import { resumirPorProducto } from '@nucleo/utils/consultaInventario';

describe('resumirPorProducto', () => {
    it('un renglón por producto, unidades con factor, sin el área de vencidos, salas en orden de despacho', () => {
        const filas = [
            { erp_product_id: 7, descripcion: 'X', erp_sucursal_id: 6, cantidad: 2, factor: 10 },
            { erp_product_id: 7, descripcion: 'X', erp_sucursal_id: 5, cantidad: 3, factor: 1 },
            { erp_product_id: 7, descripcion: 'X', erp_sucursal_id: 6, cantidad: 9, factor: 1, is_vencidos: true },
            { erp_product_id: 8, descripcion: 'Y', erp_sucursal_id: 1, cantidad: 1, factor: 1 },
        ];
        const r = resumirPorProducto(filas);
        expect(r.map(p => p.erp_product_id)).toEqual([7, 8]);
        expect(r[0].salas.map(s => [s.sala, s.unidades])).toEqual([['La Popular', 3], ['Bodega', 20]]);
    });
});
