import { describe, it, expect } from 'vitest';
import { estadoDeHojas, hojasContables, hojasContadas } from '../../src/utils/hojasRecepcion';

// El despacho de la captura del 2026-08-15 (La Popular, 4 hojas): H1 y H2 se
// contaron en una sesión anterior, H3 y H4 quedan por contar. Sus renglones ya
// contados NO llegan a la pantalla, así que H1/H2 se ven sin nada adentro.
const CUATRO_HOJAS = {
    hojaNums: [1, 2, 3, 4],
    paginaItems: {
        '1': ['a1', 'a2'],
        '2': ['b1'],
        '3': ['c1', 'c2', 'c3'],
        '4': ['d1'],
    },
    pendientesPorHoja: { 1: 0, 2: 0, 3: 3, 4: 1 },
    hojasRecibidas:  [1, 2],
    itemsEnReenvio:  [],
    itemsYaContados: ['a1', 'a2', 'b1'],
};

describe('estadoDeHojas', () => {
    it('el conteo habla de la lista que se ve: 2 de 4, no 0 de 2', () => {
        const estado = estadoDeHojas(CUATRO_HOJAS);
        expect(estado).toEqual({ 1: 'contada', 2: 'contada', 3: 'pendiente', 4: 'pendiente' });
        expect(hojasContadas(CUATRO_HOJAS.hojaNums, estado)).toEqual([1, 2]);
        expect(hojasContables(CUATRO_HOJAS.hojaNums, estado)).toEqual([1, 2, 3, 4]);
    });

    it('una hoja contada de a un producto —sin quedar en hojas_recibidas— cuenta igual', () => {
        // Se recibieron sus renglones con la búsqueda rápida: la hoja nunca se
        // «confirmó» entera, pero ya no queda nada suyo que contar. Antes esta
        // hoja se pintaba «En reenvío», que es de otra cosa.
        const estado = estadoDeHojas({
            ...CUATRO_HOJAS,
            hojasRecibidas:  [1],
            itemsYaContados: ['a1', 'a2', 'b1'],
        });
        expect(estado[2]).toBe('contada');
    });

    it('la hoja que viaja en una caja que no llegó no entra en el total', () => {
        const estado = estadoDeHojas({
            ...CUATRO_HOJAS,
            pendientesPorHoja: { 1: 0, 2: 0, 3: 3, 4: 0 },
            itemsEnReenvio:    ['d1'],
        });
        expect(estado[4]).toBe('reenvio');
        expect(hojasContables([1, 2, 3, 4], estado)).toEqual([1, 2, 3]);
        expect(hojasContadas([1, 2, 3, 4], estado)).toEqual([1, 2]);
    });

    it('la hoja confirmada en ESTA sesión sigue contada aunque sus renglones sigan en la foto', () => {
        // `rows` es una foto del momento de abrir: confirmar H3 no la vacía. Si
        // «pendiente» ganara sobre «contada», la fila volvería a ofrecer Contar.
        const estado = estadoDeHojas({
            ...CUATRO_HOJAS,
            hojasRecibidas: [1, 2, 3],
        });
        expect(estado[3]).toBe('contada');
        expect(hojasContadas([1, 2, 3, 4], estado)).toEqual([1, 2, 3]);
    });

    it('sin los ids de contexto no inventa: la hoja vacía queda fuera del total', () => {
        // Es el comportamiento viejo, y el que vale para un llamador que todavía
        // no pase los ids. Preferible a declarar contada una hoja que no lo está.
        const estado = estadoDeHojas({
            ...CUATRO_HOJAS,
            hojasRecibidas:  [],
            itemsYaContados: [],
        });
        expect(estado[1]).toBe('reenvio');
        expect(hojasContables([1, 2, 3, 4], estado)).toEqual([3, 4]);
    });

    it('sin hojas devuelve un mapa vacío', () => {
        expect(estadoDeHojas()).toEqual({});
    });
});
