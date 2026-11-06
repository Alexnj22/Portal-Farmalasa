import { describe, expect, it } from 'vitest';
import { ausenciaDelDia, cumpleEn, cumpleMesDia, esCumpleHoy, filtrarHistorial, historialDePerfil, proximasVacaciones, semanaDelPerfil, tieneHorarioPublicado, tiempoEnLaEmpresa } from '@nucleo/utils/miPerfil';

describe('miPerfil', () => {
    it('tiempo en la empresa por mes calendario', () => {
        // Meses CUMPLIDOS: el 2-oct todavía no se cumple el mes que empezó el 15.
        expect(tiempoEnLaEmpresa('2024-07-15', '2026-10-02')).toBe('2 años 2 meses');
        expect(tiempoEnLaEmpresa('2024-07-02', '2026-10-02')).toBe('2 años 3 meses');
        // El caso del reporte: entró el 4-sep, el 3-nov lleva 1 mes y 30 días.
        expect(tiempoEnLaEmpresa('2026-09-04', '2026-11-03')).toBe('1 mes');
        expect(tiempoEnLaEmpresa('2026-09-04', '2026-11-04')).toBe('2 meses');
        expect(tiempoEnLaEmpresa('2026-01-31', '2026-02-28')).toBe('28 días');
        expect(tiempoEnLaEmpresa('2025-11-03', '2026-11-03')).toBe('1 año');
        expect(tiempoEnLaEmpresa('2026-10-01', '2026-10-02')).toBe('1 día');
        expect(tiempoEnLaEmpresa('2026-10-02', '2026-10-02')).toBe('Primer día');
        expect(tiempoEnLaEmpresa(null)).toBe('—');
    });
    it('historial con el ingreso, el más reciente primero, y su filtro', () => {
        const h = historialDePerfil([{ id: 1, type: 'VACATION', date: '2026-05-01', note: 'playa' }], '2024-01-10', 'Salud 1');
        expect(h.map((e) => e.type)).toEqual(['VACATION', 'HIRING']);
        expect(filtrarHistorial(h, { tipo: 'HIRING' }).length).toBe(1);
        expect(filtrarHistorial(h, { busqueda: 'playa' })[0].id).toBe(1);
    });
    it('semana de lunes a domingo con su turno', () => {
        const s = semanaDelPerfil({ 1: 'T1', 0: 'LIBRE' }, [{ id: 'T1', name: 'Mañana' }], '2026-10-02');
        expect(s[0]).toMatchObject({ short: 'Lu', fecha: '2026-09-28', turno: { name: 'Mañana' } });
        expect(s[6]).toMatchObject({ short: 'Do', fecha: '2026-10-04', turno: null });
    });
    it('semana: horas propias sin turno cuentan, y las propias pisan al catálogo', () => {
        const turnos = [{ id: 'T1', name: 'Mañana', start: '07:00', end: '15:00' }];
        const s = semanaDelPerfil({
            1: { customStart: '08:00', customEnd: '16:00' },          // sin turno: «Manual»
            2: { shiftId: 'T1', customStart: '09:00', customEnd: '17:00' },
            3: { shiftId: 'T1', isOff: true },
            4: { shiftId: 'T1', hasLunch: true, lunchStart: '12:00' },
        }, turnos, '2026-10-02');
        expect(s[0].turno).toMatchObject({ name: 'Manual', start: '08:00', end: '16:00', manual: true });
        expect(s[1].turno).toMatchObject({ name: 'Mañana', start: '09:00', end: '17:00' });
        expect(s[2].turno).toBeNull();
        expect(s[3].minutos).toBe(7 * 60);
        expect(tieneHorarioPublicado({})).toBe(false);
        expect(tieneHorarioPublicado({ 1: 'T1' })).toBe(true);
    });
    it('ausencia, vacaciones y cumpleaños', () => {
        expect(ausenciaDelDia([{ type: 'VACATION', date: '2026-10-01', metadata: { endDate: '2026-10-05' } }], '2026-10-03')).toBeTruthy();
        expect(proximasVacaciones([{ end_date: '2026-09-01', status: 'PLANNED' }, { end_date: '2026-12-01', status: 'CONFIRMED' }], '2026-10-02').end_date).toBe('2026-12-01');
        expect(cumpleEn('1990-10-02', '2026-10-02')).toBe('¡Hoy! 🎉');
        expect(cumpleEn('1990-10-03', '2026-10-02')).toBe('Mañana');
        expect(cumpleEn('1990-10-20', '2026-10-02')).toBe('en 18 días');
        expect(cumpleEn('1990-12-25', '2026-10-02')).toBeNull();
    });

    it('cumpleaños de otro: sólo día y mes, sin la fecha completa', () => {
        // Sin permiso de Personal, `employees_safe` manda `cumple_mes_dia` y
        // `birth_date` en null: tiene que alcanzar para saber si es hoy.
        expect(cumpleMesDia({ birthDate: null, cumpleMesDia: '11-05' })).toBe('11-05');
        expect(cumpleMesDia({ cumple_mes_dia: '02-29' })).toBe('02-29');
        expect(cumpleMesDia({ birthDate: '1990-11-05' })).toBe('11-05');
        expect(cumpleMesDia({})).toBeNull();
        expect(esCumpleHoy({ cumpleMesDia: '11-05' }, '2026-11-05')).toBe(true);
        expect(esCumpleHoy({ cumpleMesDia: '11-06' }, '2026-11-05')).toBe(false);
        expect(esCumpleHoy({}, '2026-11-05')).toBe(false);
    });
});
