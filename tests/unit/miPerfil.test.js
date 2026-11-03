import { describe, expect, it } from 'vitest';
import { ausenciaDelDia, cumpleEn, filtrarHistorial, historialDePerfil, proximasVacaciones, semanaDelPerfil, tieneHorarioPublicado, tiempoEnLaEmpresa } from '@nucleo/utils/miPerfil';

describe('miPerfil', () => {
    it('tiempo en la empresa por mes calendario', () => {
        expect(tiempoEnLaEmpresa('2024-07-15', '2026-10-02')).toBe('2 años 3 meses');
        expect(tiempoEnLaEmpresa('2026-10-01', '2026-10-02')).toBe('Nuevo');
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
});
