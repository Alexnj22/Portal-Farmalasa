import { describe, expect, it } from 'vitest';
import { abiertaAhora, ahoraEnSV, alertasDeSucursal, completitudDelPerfil, horarioDeHoy, leerAjustes } from '@nucleo/utils/sucursales';

const semana = { 1: { isOpen: true, start: '07:00', end: '19:00' }, 0: { isOpen: false } };

describe('sucursales', () => {
    it('abierta o cerrada según el horario del día', () => {
        expect(abiertaAhora({ weeklyHours: semana }, 1, '10:00').status).toBe('OPEN');
        expect(abiertaAhora({ weeklyHours: semana }, 1, '19:00').status).toBe('CLOSED');
        expect(abiertaAhora({ weeklyHours: semana }, 0, '10:00').label).toBe('Cerrado hoy');
        expect(abiertaAhora({}, 1, '10:00').status).toBe('UNKNOWN');
        expect(horarioDeHoy({ weeklyHours: semana }, 0)).toBe('CERRADO');
    });
    it('la hora de El Salvador es UTC−6', () => {
        expect(ahoraEnSV(Date.parse('2026-10-05T17:40:00Z'))).toEqual({ dia: 1, hora: '11:40' });
        expect(ahoraEnSV(Date.parse('2026-10-05T03:00:00Z'))).toEqual({ dia: 0, hora: '21:00' });
    });
    it('una farmacia sin regente ni jefe tiene alertas críticas; los íconos van por nombre', () => {
        const r = alertasDeSucursal({ type: 'FARMACIA', address: 'x', phone: '1', weeklyHours: semana, settings: '{"propertyType":"OWNED"}' }, Date.parse('2026-10-05T12:00:00Z'), []);
        expect(r.critica).toBe(true);
        expect(r.list.map((a) => a.message)).toEqual(expect.arrayContaining(['Falta jefe de sucursal', 'Falta regente', 'Falta permiso SRS']));
        expect(typeof r.list[0].icono).toBe('string');
    });
    it('una bodega completa no tiene alertas', () => {
        const r = alertasDeSucursal({ type: 'BODEGA', address: 'x', phone: '1', propertyType: 'OWNED' }, Date.now(), []);
        expect(r).toMatchObject({ hasAlerts: false, message: 'Operativa' });
    });
    it('el perfil y los ajustes en texto', () => {
        expect(leerAjustes('{"a":1}')).toEqual({ a: 1 });
        expect(leerAjustes('roto')).toEqual({});
        expect(completitudDelPerfil({ type: 'BODEGA', propertyType: 'OWNED' })).toEqual({ legal: 100, property: 100, services: 100 });
    });
});
