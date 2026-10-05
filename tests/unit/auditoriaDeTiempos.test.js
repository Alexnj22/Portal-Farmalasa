import { describe, expect, it } from 'vitest';
import { auditarDia, marcasEsperadas } from '@nucleo/utils/auditoriaDeTiempos';

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
});
