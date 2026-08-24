// Las constantes que el portal entero comparte, y dos helpers del store.
//
// Todas están en un archivo propio por la misma razón: **una copia es una copia
// que se desincroniza**. El NIT escrito dentro de cada informe queda bien en
// unos y mal en otros el día que cambie, sin que nada lo avise; y los mapas de
// sala ya se duplicaron dos veces en este repo —una en `DashboardView`, otra en
// `pedidoPrint`— y la segunda se descubrió justo al estar por inventar un
// CUARTO código de sala.

import { describe, it, expect, beforeEach } from 'vitest';
import { EMPRESA } from '../../src/constants/empresa';
import { SUCURSALES, ERP_NAMES, ERP_ORDEN, BRANCH_A_ERP, ERP_CODIGOS,
         ERP_UBICACION_POR_SUCURSAL } from '../../src/constants/erp';
import { SENSITIVE_FIELDS, CACHE_KEYS, safeJsonParse, persistEmployees,
         normalizeWeeklyHours } from '../../src/store/utils';

describe('los datos fiscales de la empresa', () => {
    it('el nombre es el de la EMPRESA, no el del portal', () => {
        // «Farmalasa» es el software.
        expect(EMPRESA.razonSocial).toBe('Farmacias La Popular y La Salud');
        expect(EMPRESA.razonSocial).not.toMatch(/farmalasa/i);
    });

    it('el NIT y el NRC tienen la forma que exige Hacienda', () => {
        expect(EMPRESA.nit).toMatch(/^\d{4}-\d{6}-\d{3}-\d$/);
        expect(EMPRESA.nrc).toMatch(/^\d+-\d$/);
    });
});

describe('las salas: tres numeraciones que no se deducen entre sí', () => {
    it('el mapa de nombres tiene las siete', () => {
        expect(Object.keys(ERP_NAMES)).toHaveLength(7);
        expect(ERP_NAMES[6]).toBe('Bodega');
    });

    it('el orden del NEGOCIO no es el numérico: La Popular primero, Bodega al final', () => {
        // Es el orden de despacho, y el que usan todos los selectores del portal.
        expect(ERP_ORDEN[0]).toBe(5);
        expect(ERP_ORDEN.at(-1)).toBe(6);
        expect(ERP_ORDEN).not.toEqual([...ERP_ORDEN].sort((a, b) => a - b));
    });

    it('el orden nombra exactamente a las salas que existen', () => {
        expect([...ERP_ORDEN].sort()).toEqual(Object.keys(ERP_NAMES).map(Number).sort());
    });

    it('las sucursales de venta son las seis: Bodega no vende', () => {
        expect(SUCURSALES).toHaveLength(6);
        expect(SUCURSALES).not.toContain(6);
    });

    it('la sala del portal y la del origen NO coinciden en ninguna', () => {
        // La equivocada apunta a otra sala sin dar error.
        for (const [branch, erp] of Object.entries(BRANCH_A_ERP))
            expect(Number(branch), `branch ${branch}`).not.toBe(erp);
    });

    it('cada sala del portal apunta a una del origen, y ninguna se repite', () => {
        const destinos = Object.values(BRANCH_A_ERP);
        expect(new Set(destinos).size).toBe(destinos.length);
        for (const d of destinos) expect(ERP_NAMES[d]).toBeTruthy();
    });

    it('el CÓDIGO corto no es el número de la sala', () => {
        // Armarlo con el id da «S7» para Salud 5 y —peor— «S5» para La Popular,
        // que se lee como otra sala que sí existe. La autoridad es
        // `erp_sucursal_map.codigo` en la base; esto es el espejo.
        expect(ERP_CODIGOS[7]).toBe('S5');
        expect(ERP_CODIGOS[5]).toBe('PO');
        expect(ERP_CODIGOS[6]).toBe('BO');
    });

    it('ningún código se repite: uno repetido nombra a otra sala', () => {
        const codigos = Object.values(ERP_CODIGOS);
        expect(new Set(codigos).size).toBe(codigos.length);
        expect(Object.keys(ERP_CODIGOS)).toHaveLength(7);
    });

    it('la UBICACIÓN de inventario es una tercera numeración', () => {
        // Se leyó del propio sistema, no se adivinó: la equivocada apunta a otro
        // almacén sin dar error. Bodega tiene dos —operación y vencidos— y acá
        // va la de operación, porque la de vencidos es a donde LLEGA lo
        // descartado, no de donde sale.
        expect(Object.keys(ERP_UBICACION_POR_SUCURSAL)).toHaveLength(7);
        const ubis = Object.values(ERP_UBICACION_POR_SUCURSAL);
        expect(new Set(ubis).size).toBe(ubis.length);
        expect(ERP_UBICACION_POR_SUCURSAL[6]).toBe(1);
    });

    it('la ubicación NO es el número de sala, salvo por casualidad', () => {
        const iguales = Object.entries(ERP_UBICACION_POR_SUCURSAL)
            .filter(([s, u]) => Number(s) === u);
        expect(iguales.length).toBeLessThan(3);   // confundirlas «funciona» a veces: por eso sobrevive
    });
});

describe('lo que NO se guarda en el navegador', () => {
    beforeEach(() => localStorage.clear());

    it('la lista de campos sensibles incluye la credencial y el dinero', () => {
        for (const campo of ['kiosk_pin', 'dui', 'base_salary', 'account_number', 'bank_name'])
            expect(SENSITIVE_FIELDS).toContain(campo);
    });

    it('el caché de empleados NO se lleva ninguno de ellos', () => {
        // `localStorage` sobrevive al cierre de sesión y lo lee cualquiera que
        // se siente en esa computadora.
        persistEmployees([{ id: 1, name: 'Ana', kiosk_pin: 'ABCD1234', dui: '000',
                            base_salary: 500, account_number: '1', bank_name: 'X' }]);
        const crudo = localStorage.getItem(CACHE_KEYS.EMPLOYEES);
        for (const campo of SENSITIVE_FIELDS) expect(crudo).not.toContain(campo);
        expect(crudo).not.toContain('ABCD1234');
    });

    it('tampoco el historial ni los documentos: son el peso, no el dato', () => {
        persistEmployees([{ id: 1, name: 'Ana', history: [1, 2, 3], documents: [{ a: 1 }] }]);
        const [emp] = JSON.parse(localStorage.getItem(CACHE_KEYS.EMPLOYEES));
        expect(emp.history).toEqual([]);
        expect(emp.documents).toEqual([]);
    });

    it('de las marcaciones sólo quedan las de las últimas 24 horas', () => {
        const ahora = new Date().toISOString();
        const viejo = new Date(Date.now() - 48 * 3600_000).toISOString();
        persistEmployees([{ id: 1, attendance: [{ timestamp: viejo }, { timestamp: ahora }] }]);
        const [emp] = JSON.parse(localStorage.getItem(CACHE_KEYS.EMPLOYEES));
        expect(emp.attendance).toHaveLength(1);
        expect(emp.attendance[0].timestamp).toBe(ahora);
    });

    it('devuelve la lista ORIGINAL, no la recortada', () => {
        // Quien la llama sigue trabajando con los datos completos: el recorte es
        // sólo para el disco.
        const emps = [{ id: 1, kiosk_pin: 'X' }];
        expect(persistEmployees(emps)).toBe(emps);
        expect(emps[0].kiosk_pin).toBe('X');
    });

    it('un `localStorage` lleno no rompe el arranque', () => {
        const set = localStorage.setItem;
        localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
        expect(() => persistEmployees([{ id: 1 }])).not.toThrow();
        localStorage.setItem = set;
    });
});

describe('leer JSON del navegador sin confiar en él', () => {
    it('lo válido se devuelve', () => {
        expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    });

    it('lo corrupto cae al respaldo, no revienta la pantalla', () => {
        // Es lo que hay entre un `localStorage` manipulado y una pantalla en
        // blanco.
        expect(safeJsonParse('{roto')).toBeNull();
        expect(safeJsonParse('{roto', [])).toEqual([]);
        expect(safeJsonParse(undefined, {})).toEqual({});
    });

    it('OJO: `null` NO cae al respaldo, porque `JSON.parse(null)` no lanza', () => {
        // Devuelve `null`, que es exactamente lo que `localStorage.getItem`
        // entrega cuando la clave no existe. O sea que «no hay nada guardado» y
        // «hay basura guardada» se contestan distinto: el primero devuelve
        // `null` aunque se haya pedido otro respaldo. Los llamadores del repo
        // encadenan `|| []`, así que hoy no hace daño — se ancla para que se
        // sepa antes de confiar en el segundo argumento.
        expect(safeJsonParse(null, [])).toBeNull();
    });
});

describe('el horario semanal normalizado', () => {
    it('siempre devuelve los siete días, con el domingo como 0', () => {
        const r = normalizeWeeklyHours({});
        expect(Object.keys(r).map(Number).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('acepta el domingo escrito como 7 y lo guarda como 0', () => {
        // La convención contraria vivía escrita en seis lugares y hacía
        // invisible el domingo.
        const r = normalizeWeeklyHours({ 7: { isOpen: true, start: '08:00', end: '12:00' } });
        expect(r[0]).toEqual({ isOpen: true, start: '08:00', end: '12:00' });
    });

    it('un día cerrado no conserva horas: no hay «cerrado de 8 a 18»', () => {
        const r = normalizeWeeklyHours({ 1: { isOpen: false, start: '08:00', end: '18:00' } });
        expect(r[1]).toEqual({ isOpen: false, start: '', end: '' });
    });

    it('lo que no es texto ni booleano se descarta', () => {
        const r = normalizeWeeklyHours({ 1: { isOpen: 'sí', start: 8, end: null } });
        expect(r[1]).toEqual({ isOpen: false, start: '', end: '' });
    });

    it('sin horario devuelve la semana entera cerrada, no `undefined`', () => {
        const r = normalizeWeeklyHours(null);
        expect(Object.values(r).every(d => d.isOpen === false)).toBe(true);
    });
});
