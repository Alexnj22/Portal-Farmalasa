import { describe, it, expect } from 'vitest';
import { getTodayScheduleConfig } from '../../src/utils/helpers';
import { resolveAttendanceFlow } from '../../src/utils/timeClock.helpers';
import { buildCustomConfig, buildFinalPunchPresentation } from '../../src/utils/timeClock.rules';

// El horario semanal se guarda en `employee_rosters.schedule_data` con las
// claves que produce `Date.getDay()` — o sea **domingo = "0"**. Medido sobre
// las 103 filas de producción: las únicas claves que existen son "0".."6", no
// hay ni una "7".
//
// Quien las escribe (SchedulesView / ScheduleCalendar) y quien las consolida en
// planilla (`consolidate-timesheets`) usan esa misma convención. El lector del
// kiosco usaba la contraria (domingo = 7), así que buscaba una clave que no
// existe y daba el domingo por libre para TODO el mundo.
const TURNO_APERTURA = { id: 25, name: 'Apertura', start: '07:00', end: '16:00' };
const SHIFTS = [TURNO_APERTURA];

const rosterTodaLaSemana = () => {
    const dia = { isOff: false, shiftId: '25', hasLunch: true, lunchStart: '12:00' };
    return { 0: dia, 1: dia, 2: dia, 3: dia, 4: dia, 5: dia, 6: { isOff: true, shiftId: '' } };
};

const empleado = (extra = {}) => ({
    id: 'emp-1',
    name: 'Persona de Prueba',
    weeklySchedule: rosterTodaLaSemana(),
    attendance: [],
    ...extra,
});

// 2026-08-16 es domingo; 2026-08-17, lunes.
const DOMINGO_8AM = new Date(2026, 7, 16, 8, 0, 0);
const LUNES_8AM   = new Date(2026, 7, 17, 8, 0, 0);
const SABADO_8AM  = new Date(2026, 7, 15, 8, 0, 0);

describe('getTodayScheduleConfig — el día de la semana sale de la misma clave que se guardó', () => {
    it('el lunes resuelve el turno del horario', () => {
        const cfg = getTodayScheduleConfig(empleado(), SHIFTS, LUNES_8AM);
        expect(cfg.isOffDay).toBe(false);
        expect(cfg.shift.start).toBe('07:00');
        expect(cfg.shift.end).toBe('16:00');
    });

    it('el DOMINGO resuelve el turno, no lo da por día libre', () => {
        const cfg = getTodayScheduleConfig(empleado(), SHIFTS, DOMINGO_8AM);
        expect(cfg.isOffDay).toBe(false);
        expect(cfg.shift.start).toBe('07:00');
    });

    it('respeta el día marcado como libre (sábado en este horario)', () => {
        const cfg = getTodayScheduleConfig(empleado(), SHIFTS, SABADO_8AM);
        expect(cfg.isOffDay).toBe(true);
    });

    it('sin horario cargado el día queda libre', () => {
        const cfg = getTodayScheduleConfig(empleado({ weeklySchedule: {} }), SHIFTS, LUNES_8AM);
        expect(cfg.isOffDay).toBe(true);
    });
});

describe('resolveAttendanceFlow — qué marcaje toca', () => {
    const flujo = (emp, ahora) => {
        const customConfig = buildCustomConfig({ employee: emp, now: ahora, shifts: SHIFTS, todayPunches: [] });
        return resolveAttendanceFlow({ employee: emp, customConfig, currentDate: ahora });
    };

    it('un domingo laboral da una ENTRADA normal, sin pedir autorización', () => {
        const f = flujo(empleado(), DOMINGO_8AM);
        expect(f.type).toBe('IN');
        expect(f.requiresAuth).toBe(false);
    });

    it('con la entrada ya hecha, el siguiente marcaje del domingo es una salida', () => {
        const emp = empleado({
            attendance: [{ type: 'IN', timestamp: new Date(2026, 7, 16, 7, 0, 0).toISOString() }],
        });
        const f = flujo(emp, new Date(2026, 7, 16, 16, 0, 0));
        expect(f.type).toBe('OUT');
    });

    it('un día realmente libre sí pide autorización', () => {
        const f = flujo(empleado(), SABADO_8AM);
        expect(f.type).toBe('IN_EXTRA');
        expect(f.requiresAuth).toBe(true);
    });
});

describe('sin horario cargado — decisión del usuario: que marque igual', () => {
    // 41 de 49 empleados activos no tenían horario publicado para la semana del
    // 17-ago-2026. Con el comportamiento viejo (sin horario = día libre) cada
    // uno de esos marcajes habría pedido autorización de supervisor.
    const sinHorario = () => empleado({ has_roster: false, weeklySchedule: {} });

    it('el día no se toma como libre', () => {
        const cfg = getTodayScheduleConfig(sinHorario(), SHIFTS, LUNES_8AM);
        expect(cfg.isOffDay).toBe(false);
        expect(cfg.sinHorario).toBe(true);
    });

    it('da una entrada normal, sin autorización', () => {
        const emp = sinHorario();
        const customConfig = buildCustomConfig({ employee: emp, now: LUNES_8AM, shifts: SHIFTS, todayPunches: [] });
        const f = resolveAttendanceFlow({ employee: emp, customConfig, currentDate: LUNES_8AM });
        expect(f.type).toBe('IN');
        expect(f.requiresAuth).toBe(false);
    });

    it('el marcaje queda señalado para la revisión de Talento Humano', () => {
        const emp = sinHorario();
        const customConfig = buildCustomConfig({ employee: emp, now: LUNES_8AM, shifts: SHIFTS, todayPunches: [] });
        const p = buildFinalPunchPresentation({
            employee: emp, type: 'IN', rawType: 'IN', customConfig, now: LUNES_8AM, shifts: SHIFTS,
        });
        expect(p.metadata.sinHorario).toBe(true);
        expect(p.metadata.pendingHRReview).toBe(true);
        expect(p.warning).toMatch(/horario/i);
    });

    it('quien SÍ tiene horario no queda marcado como sin horario', () => {
        const emp = empleado({ has_roster: true });
        const customConfig = buildCustomConfig({ employee: emp, now: LUNES_8AM, shifts: SHIFTS, todayPunches: [] });
        const p = buildFinalPunchPresentation({
            employee: emp, type: 'IN', rawType: 'IN', customConfig, now: LUNES_8AM, shifts: SHIFTS,
        });
        expect(p.metadata.sinHorario).toBeUndefined();
    });
});
