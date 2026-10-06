import { describe, expect, it } from 'vitest';
import { compararAsistencia, estadoDeAsistencia } from '@nucleo/utils/estadoDeAsistencia';

const hoy = new Date(2026, 9, 5, 10, 0, 0);
const marca = (h, m, type) => ({ timestamp: new Date(2026, 9, 5, h, m).toISOString(), type });

describe('estadoDeAsistencia', () => {
    it('sin horario ni marcas, la persona está libre', () => {
        expect(estadoDeAsistencia({ attendance: [] }, [], hoy).status).toBe('OFF_DAY');
    });
    it('la última marca decide el estado', () => {
        expect(estadoDeAsistencia({ attendance: [marca(7, 0, 'IN')] }, [], hoy).status).toBe('WORKING');
        expect(estadoDeAsistencia({ attendance: [marca(7, 0, 'IN'), marca(9, 0, 'OUT_LUNCH')] }, [], hoy).status).toBe('LUNCH');
        expect(estadoDeAsistencia({ attendance: [marca(7, 0, 'IN'), marca(9, 50, 'OUT')] }, [], hoy)).toMatchObject({ status: 'FINISHED' });
    });
    it('volver tarde del almuerzo se cuenta', () => {
        const r = estadoDeAsistencia({ attendance: [marca(7, 0, 'IN'), marca(8, 0, 'OUT_LUNCH'), marca(9, 20, 'IN_LUNCH')] }, [], hoy);
        expect(r).toMatchObject({ status: 'WORKING', isLate: true, lateText: '20 min tarde' });
    });
    it('el orden pone primero a quien llegó tarde', () => {
        const filas = [
            { emp: { name: 'B' }, status: 'OFF_DAY' }, { emp: { name: 'A' }, status: 'WORKING' },
            { emp: { name: 'C' }, status: 'WORKING', isLate: true }, { emp: { name: 'D' }, status: 'PENDING' },
        ];
        expect([...filas].sort(compararAsistencia).map((f) => f.emp.name)).toEqual(['C', 'D', 'A', 'B']);
    });
});
