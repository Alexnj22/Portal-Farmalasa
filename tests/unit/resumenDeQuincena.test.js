import { describe, expect, it } from 'vitest';
import { resumenDeQuincena, RESUMEN_VACIO } from '@nucleo/utils/auditoriaDeTiempos';

describe('resumenDeQuincena', () => {
    it('suma por persona y en total, con aprobados y ausencias', () => {
        const { porPersona, total } = resumenDeQuincena([
            { employee_id: 'a', regular_hours: 8, overtime_hours: 1, nocturnal_hours: 2, late_minutes: 5, status: 'APPROVED' },
            { employee_id: 'a', regular_hours: 8, is_absent: false, status: 'PENDING' },
            { employee_id: 'b', is_absent: true, status: 'APPROVED' },
        ]);
        expect(porPersona.get('a')).toMatchObject({ regular: 16, overtime: 1, nocturnal: 2, late: 5, approved: 1, total: 2, absent: 0 });
        expect(porPersona.get('b')).toMatchObject({ absent: 1, approved: 1, total: 1 });
        expect(total).toMatchObject({ regular: 16, absent: 1, approved: 2, total: 3 });
    });
    it('sin filas no inventa nada', () => {
        const { porPersona, total } = resumenDeQuincena([]);
        expect(porPersona.size).toBe(0);
        expect(total).toEqual({ ...RESUMEN_VACIO });
    });
});
