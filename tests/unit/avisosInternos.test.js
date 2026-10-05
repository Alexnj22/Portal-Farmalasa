import { describe, expect, it } from 'vitest';
import { audienciaDeAviso, avisoConLectura, seccionDeAviso } from '@nucleo/utils/avisosInternos';

const gente = [{ id: 1, branchId: 2, role: 'Regente' }, { id: 2, branchId: 2, role: 'Cajero' }, { id: 3, branchId: 5, role: 'Regente' }];

describe('avisosInternos', () => {
    it('a quién le llega', () => {
        expect(audienciaDeAviso(gente, 'GLOBAL')).toHaveLength(3);
        expect(audienciaDeAviso(gente, 'BRANCH', '2').map((e) => e.id)).toEqual([1, 2]);
        expect(audienciaDeAviso(gente, 'ROLE', 'Regente').map((e) => e.id)).toEqual([1, 3]);
        expect(audienciaDeAviso(gente, 'EMPLOYEE', ['3']).map((e) => e.id)).toEqual([3]);
    });
    it('la lectura y el destino', () => {
        const a = avisoConLectura({ targetType: 'BRANCH', targetValue: 2, readBy: [{ employeeId: 1 }] }, gente, new Map([['2', 'Salud 2']]));
        expect(a.readPercentage).toBe(50);
        expect(a.badgeText).toBe('Salud 2');
        expect(a.isCompleted).toBe(false);
        expect(avisoConLectura({ targetType: 'BRANCH', targetValue: 2, readBy: [1, 2] }, gente).isCompleted).toBe(true);
    });
    it('la sección', () => {
        const ahora = new Date('2026-10-05T12:00:00Z');
        expect(seccionDeAviso({ isCompleted: true, scheduledFor: '2026-12-01' }, ahora)).toBe('ARCHIVED');
        expect(seccionDeAviso({ scheduledFor: '2026-10-06T00:00:00Z' }, ahora)).toBe('SCHEDULED');
        expect(seccionDeAviso({}, ahora)).toBe('ACTIVE');
    });
});
