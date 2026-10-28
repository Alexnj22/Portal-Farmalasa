import { describe, expect, it } from 'vitest';
import {
    alternarEnfermera, cambiosDeSucursal, idsDeEnfermeria, resumenDeCambios, rotuloCategoriaSrs,
} from '@nucleo/utils/edicionDeSucursal';
import { documentosDeSucursal } from '@nucleo/utils/expedienteDeSucursal';
import { alertasDeSucursal } from '@nucleo/utils/sucursales';

describe('enfermería: nursingRegents es la lista que manda', () => {
    it('lee nursingRegents y sólo cae a nurses en filas viejas', () => {
        expect(idsDeEnfermeria({ nursingRegents: [{ employeeId: 5 }, { employeeId: '' }], nurses: [9] })).toEqual([5]);
        expect(idsDeEnfermeria({ nursingRegents: [], nurses: [9] })).toEqual([]);
        expect(idsDeEnfermeria({ nurses: [9] })).toEqual([9]);
        expect(idsDeEnfermeria(null)).toEqual([]);
    });
    it('alternar escribe en nursingRegents y conserva los documentos de las demás', () => {
        const legal = { nursingRegents: [{ id: 1, employeeId: 'a', carneUrl: 'u' }] };
        const mas = alternarEnfermera(legal, 'b', 100);
        expect(mas).toEqual([{ id: 1, employeeId: 'a', carneUrl: 'u' }, { id: 100, employeeId: 'b', anualidadExp: '' }]);
        expect(alternarEnfermera({ nursingRegents: mas }, 'b')).toEqual([{ id: 1, employeeId: 'a', carneUrl: 'u' }]);
    });
    it('una fila vieja con sólo nurses se migra al alternar', () => {
        const r = alternarEnfermera({ nurses: ['a'] }, 'b', 100);
        expect(r.map((n) => n.employeeId)).toEqual(['a', 'b']);
    });
    it('la alerta de «falta enfermero/a» mira nursingRegents', () => {
        const base = { type: 'FARMACIA', address: 'x', phone: '1', propertyType: 'OWNED' };
        const con = alertasDeSucursal({ ...base, settings: { legal: { injections: true, nursingRegents: [{ employeeId: 3 }] } } }, Date.now());
        const sin = alertasDeSucursal({ ...base, settings: { legal: { injections: true, nurses: [], nursingRegents: [] } } }, Date.now());
        expect(con.list.some((a) => a.message === 'Falta enfermero/a')).toBe(false);
        expect(sin.list.some((a) => a.message === 'Falta enfermero/a')).toBe(true);
    });
});

describe('SRS y libros controlados', () => {
    it('categoría SRS por código', () => {
        expect(rotuloCategoriaSrs('3')).toBe('Categoría 3');
        expect(rotuloCategoriaSrs('')).toBeNull();
        expect(rotuloCategoriaSrs(undefined)).toBeNull();
    });
    it('el expediente muestra categoría e inscripción junto a la licencia, y el vencimiento de libros', () => {
        const e = documentosDeSucursal({ settings: { legal: { srsPermit: 'F1', srsCategoria: '3', controlledBooks: true, controlledBooksExp: '2027-01-01' } } });
        const srs = e.permisos.find((d) => d.id === 'srs');
        expect(srs.datos).toEqual([
            { rotulo: 'Resolución', valor: 'F1' },
            { rotulo: 'Categoría SRS', valor: 'Categoría 3' },
            { rotulo: 'Inscripción SRS', valor: null },
        ]);
        expect(e.permisos.find((d) => d.id === 'libros').expDate).toBe('2027-01-01');
    });
    it('el vencimiento de libros dispara la alerta', () => {
        const b = { type: 'FARMACIA', settings: { legal: { controlledBooks: true, controlledBooksExp: '2020-01-01' } } };
        expect(alertasDeSucursal(b, Date.now()).list.some((a) => a.message.startsWith('Libros Controlados'))).toBe(true);
    });
});

describe('cambiosDeSucursal (bitácora)', () => {
    const antes = {
        name: 'Salud 1', address: 'A', phone: '1', cell: null, opening_date: '2020-01-01T00:00:00',
        weekly_hours: { 1: { isOpen: true, start: '07:00', end: '19:00' } },
        settings: { legal: { srsPermit: 'F1', regentEmployeeId: 1, extinguisherCount: 2 }, services: { light: { provider: 'CAESS' } }, rent: null },
    };
    it('nada cambió: vacío', () => {
        expect(cambiosDeSucursal(antes, JSON.parse(JSON.stringify({ ...antes, settings: { ...antes.settings, rent: {} } })))).toEqual([]);
    });
    it('separa secciones y omite lo que ya tiene entrada propia', () => {
        const despues = {
            ...antes, address: 'B', opening_date: '2020-01-01',
            weekly_hours: { 1: { isOpen: true, start: '08:00', end: '19:00' } },
            settings: {
                legal: { srsPermit: 'F1', srsCategoria: '3', regentEmployeeId: 2, extinguisherCount: 3 },
                services: { light: { provider: 'DELSUR' } },
            },
        };
        const c = cambiosDeSucursal(antes, despues);
        expect(c).toEqual([
            { seccion: 'general', campos: ['address'] },
            { seccion: 'legal', campos: ['srsCategoria'] },
            { seccion: 'horarios', campos: ['weekly_hours'] },
            { seccion: 'inmueble', campos: ['extinguisherCount'] },
            { seccion: 'servicios', campos: ['light'] },
        ]);
        expect(resumenDeCambios(c)).toBe('General: dirección · Legal: categoría SRS · Horarios · Inmueble: extintores · Servicios: energía eléctrica');
    });
});
