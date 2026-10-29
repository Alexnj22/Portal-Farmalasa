import { describe, it, expect } from 'vitest';
import {
    parchesDeAjustes, columnasCambiadas, documentosDeEnfermeriaQueSalen, horarioCruzaMedianoche, esAlquilada,
} from '@nucleo/utils/edicionDeSucursal';

// El guardado de una sucursal manda SÓLO lo que cambió y la base lo aplica
// sobre la fila viva (`editar_sucursal`). Si esto devolviera de más, volvería
// el defecto: pisar lo que otra persona guardó entretanto.
describe('parchesDeAjustes', () => {
    it('sólo devuelve las hojas que cambiaron', () => {
        const base = { legal: { srsPermit: 'A', srsPermitUrl: 'u1' }, services: { light: { paidThrough: '2026-09' } } };
        const nuevo = { legal: { srsPermit: 'B', srsPermitUrl: 'u1' }, services: { light: { paidThrough: '2026-09' } } };
        expect(parchesDeAjustes(base, nuevo)).toEqual([{ ruta: ['legal', 'srsPermit'], valor: 'B' }]);
    });

    it('una clave ausente en lo nuevo NO es un borrado', () => {
        const base = { legal: { srsPermitUrl: 'u1', municipalUrl: 'm1' } };
        expect(parchesDeAjustes(base, { legal: { municipalUrl: 'm1' } })).toEqual([]);
    });

    it('null vacía el dato', () => {
        expect(parchesDeAjustes({ legal: { srsPermitUrl: 'u1' } }, { legal: { srsPermitUrl: null } }))
            .toEqual([{ ruta: ['legal', 'srsPermitUrl'], valor: null }]);
    });

    it('los arreglos se reemplazan enteros', () => {
        const p = parchesDeAjustes({ legal: { nursingRegents: [{ id: 1 }] } }, { legal: { nursingRegents: [{ id: 1 }, { id: 2 }] } });
        expect(p).toEqual([{ ruta: ['legal', 'nursingRegents'], valor: [{ id: 1 }, { id: 2 }] }]);
    });

    it('un objeto nuevo entero se manda como hoja', () => {
        expect(parchesDeAjustes({}, { rent: { amount: 300 } })).toEqual([{ ruta: ['rent'], valor: { amount: 300 } }]);
    });

    it('vacío contra ausente no es un cambio', () => {
        expect(parchesDeAjustes({ legal: {} }, { legal: { srsPermit: '' } })).toEqual([]);
    });
});

describe('columnasCambiadas', () => {
    it('sólo las columnas que el formulario cambió, vacío → null', () => {
        const base = { name: 'Salud 1', address: 'Calle 1', phone: '2222', weekly_hours: { 1: { isOpen: true } } };
        const payload = { name: 'Salud 1', address: '', phone: '2222', weeklyHours: { 1: { isOpen: true } } };
        expect(columnasCambiadas(base, payload)).toEqual({ address: null });
    });

    it('un nombre vacío no se escribe', () => {
        expect(columnasCambiadas({ name: 'Salud 1' }, { name: '  ' })).toEqual({});
    });
});

describe('documentosDeEnfermeriaQueSalen', () => {
    it('archiva los de una fila que se quita y los que se vacían', () => {
        const antes = [{ id: 1, employeeId: 'a', carneUrl: 'c1' }, { id: 2, employeeId: 'b', licenciaUrl: 'l2', anualidadUrl: 'x2' }];
        const despues = [{ id: 2, employeeId: 'b', licenciaUrl: 'l2', anualidadUrl: '' }];
        expect(documentosDeEnfermeriaQueSalen(antes, despues)).toEqual([
            { campo: 'carneUrl', url: 'c1', employeeId: 'a' },
            { campo: 'anualidadUrl', url: 'x2', employeeId: 'b' },
        ]);
    });
});

describe('horarioCruzaMedianoche / esAlquilada', () => {
    it('detecta un cierre que no es posterior a la apertura', () => {
        expect(horarioCruzaMedianoche({ 1: { isOpen: true, start: '07:00', end: '22:00' } })).toBe(false);
        expect(horarioCruzaMedianoche({ 1: { isOpen: true, start: '20:00', end: '02:00' } })).toBe(true);
        expect(horarioCruzaMedianoche({ 1: { isOpen: false, start: '20:00', end: '02:00' } })).toBe(false);
    });
    it('RENTED y ALQUILADO son lo mismo', () => {
        expect(esAlquilada({ propertyType: 'ALQUILADO' })).toBe(true);
        expect(esAlquilada({}, { propertyType: 'RENTED' })).toBe(true);
        expect(esAlquilada({ propertyType: 'OWNED' })).toBe(false);
    });
});
