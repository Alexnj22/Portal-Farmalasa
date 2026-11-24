import { describe, expect, it } from 'vitest';
import { auditarDia, horarioDeLaSemana, indexarHorarios, marcasEsperadas } from '@nucleo/utils/auditoriaDeTiempos';

const turno = { id: 1, start_time: '07:00:00', end_time: '15:00:00' };
const shiftById = new Map([['1', turno]]);
const lunes = '2026-10-05';   // un lunes
const emp = (attendance, extra = {}) => ({ id: 'e1', weeklySchedule: { 1: { shiftId: 1, lunchStart: '12:00' } }, attendance, ...extra });
const ahora = new Date('2026-10-06T15:00:00Z');   // el día siguiente: el lunes ya terminó (antes, no hay faltas)

describe('auditoriaDeTiempos', () => {
    it('el turno espera entrada, almuerzo y salida', () => {
        expect(marcasEsperadas(lunes, turno, { lunchStart: '12:00' }).map((m) => m.type)).toEqual(['IN', 'OUT_LUNCH', 'IN_LUNCH', 'OUT']);
    });
    it('cuenta las marcas que faltan y la tardanza', () => {
        const a = auditarDia({ dateStr: lunes, emp: emp([{ id: 1, type: 'IN', timestamp: '2026-10-05T13:20:00Z' }]), shiftById, homeBranchId: 2, now: ahora });
        expect(a.isOff).toBe(false);
        expect(a.inconsistencies.map((i) => i.type)).toEqual(['OUT_LUNCH', 'IN_LUNCH', 'OUT']);
        expect(a.lateMin).toBe(20);
    });
    it('un día sin horario es libre y no tiene faltas', () => {
        const a = auditarDia({ dateStr: lunes, emp: { id: 'e2', attendance: [] }, shiftById, homeBranchId: 2, now: ahora });
        expect(a).toMatchObject({ isOff: true, isNoSchedule: true, inconsistencies: [] });
    });
    it('marcar en otra sala es apoyo, y el auto-marcado se detecta', () => {
        const a = auditarDia({
            dateStr: lunes, homeBranchId: 2, now: ahora, shiftById, branchNameById: new Map([['4', 'Salud 1']]),
            emp: emp([{ id: 1, type: 'IN', timestamp: '2026-10-05T13:00:00Z', details: { audit_info: { branchId: 4 } } },
                { id: 2, type: 'OUT', timestamp: '2026-10-05T21:00:00Z', details: { autoInserted: true } }]),
        });
        expect(a.crossBranchName).toBe('Salud 1');
        expect(a.isAutoDay).toBe(true);
    });
    // 2026-11-24 · un día sin horario con marcas se pintaba «Día libre» y
    // escondía las marcas y el «Corregir».
    const marcas = [{ id: 1, type: 'IN', timestamp: '2026-10-05T20:12:00Z' }, { id: 2, type: 'OUT', timestamp: '2026-10-06T03:00:00Z' }];
    it('sin horario pero con marcas: trabajó sin horario, no libre', () => {
        const a = auditarDia({ dateStr: lunes, emp: { id: 'e3', attendance: marcas, weeklySchedule: {} }, shiftById, homeBranchId: 2, now: ahora });
        expect(a).toMatchObject({ isOff: false, trabajoSinHorario: true, isNoSchedule: true, inconsistencies: [] });
        expect(a.dayPunches).toHaveLength(2);
    });
    it('libre explícito (también shiftId LIBRE) con marcas: trabajó sin horario', () => {
        for (const dia of [{ isOff: true }, { shiftId: 'LIBRE' }, { isOffDay: true }]) {
            const a = auditarDia({ dateStr: lunes, emp: { id: 'e3', attendance: marcas, weeklySchedule: { 1: dia } }, shiftById, homeBranchId: 2, now: ahora });
            expect(a).toMatchObject({ isOff: false, trabajoSinHorario: true, isExplicitOff: true });
        }
    });
    it('sin horario y sin marcas pero con planilla trabajada: trabajó sin horario', () => {
        const ts = [{ employee_id: 'e4', work_date: lunes, regular_hours: 8, is_absent: false }];
        const a = auditarDia({ dateStr: lunes, emp: { id: 'e4', attendance: [] }, shiftById, timesheets: ts, homeBranchId: 2, now: ahora });
        expect(a).toMatchObject({ isOff: false, trabajoSinHorario: true });
    });
    it('horas propias sin turno del catálogo: trabaja (lo decide resolverTurnoDelDia)', () => {
        const a = auditarDia({ dateStr: lunes, emp: { id: 'e5', attendance: [], weeklySchedule: { 1: { isOff: false, shiftId: '', customStart: '14:00', customEnd: '21:00' } } }, shiftById, homeBranchId: 2, now: ahora });
        expect(a).toMatchObject({ isOff: false, trabajoSinHorario: false, shiftStart: '14:00', shiftEnd: '21:00' });
        expect(a.turno).toMatchObject({ trabaja: true, esManual: true });
        expect(a.inconsistencies.map((i) => i.type)).toEqual(['IN', 'OUT']);
    });
    it('cada día se juzga con el horario de SU semana', () => {
        const indice = indexarHorarios([
            { employee_id: 'e6', week_start_date: '2026-09-28', schedule_data: { 1: { isOff: true } } },
            { employee_id: 'e6', week_start_date: '2026-10-05', schedule_data: { 1: { shiftId: 1 } } },
        ]);
        const persona = { id: 'e6', attendance: [], weeklySchedule: { 1: { shiftId: 1 } } };
        const pasado = auditarDia({ dateStr: '2026-09-28', emp: persona, horario: horarioDeLaSemana(indice, 'e6', '2026-09-28'), shiftById, homeBranchId: 2, now: ahora });
        expect(pasado).toMatchObject({ isOff: true, isExplicitOff: true });
        const domingo = auditarDia({ dateStr: '2026-10-11', emp: persona, horario: horarioDeLaSemana(indice, 'e6', '2026-10-11'), shiftById, homeBranchId: 2, now: new Date('2026-10-12T15:00:00Z') });
        expect(domingo.isOff).toBe(true);   // la semana del 5 no tiene domingo
        expect(horarioDeLaSemana(indice, 'e6', '2026-09-21')).toBeNull();   // semana sin publicar
        expect(horarioDeLaSemana(null, 'e6', '2026-09-21')).toBeUndefined();   // sin índice: la semana en curso
        const sinPublicar = auditarDia({ dateStr: '2026-09-21', emp: { ...persona, attendance: marcas.map((m) => ({ ...m, timestamp: m.timestamp.replace('2026-10-05', '2026-09-21').replace('2026-10-06', '2026-09-22') })) }, horario: null, shiftById, homeBranchId: 2, now: ahora });
        expect(sinPublicar).toMatchObject({ isOff: false, trabajoSinHorario: true });
    });
});

