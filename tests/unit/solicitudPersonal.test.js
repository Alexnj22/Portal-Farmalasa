import { describe, expect, it } from 'vitest';
import {
    antiguedadDe, choqueEnRango, companeroNoDisponible, diasDe, finDeIncapacidad, incapacidadesVigentes, motivoParaNoEnviar,
} from '@nucleo/utils/solicitudPersonal';

const base = { empleadoId: '1', nota: 'motivo', antiguedad: { habilitado: true }, anioActual: 2026 };

describe('solicitudPersonal', () => {
    it('cuenta días y el fin de una incapacidad', () => {
        expect(diasDe('2026-10-01', '2026-10-15')).toBe(15);
        expect(finDeIncapacidad('2026-10-01', 3)).toBe('2026-10-03');
        expect(finDeIncapacidad('2026-10-01', 0)).toBeNull();
    });
    it('vacaciones exigen un año cumplido', () => {
        expect(antiguedadDe('2026-01-01', new Date('2026-10-01T12:00:00')).habilitado).toBe(false);
        expect(antiguedadDe('2024-01-01', new Date('2026-10-01T12:00:00')).habilitado).toBe(true);
        expect(motivoParaNoEnviar({ ...base, tipo: 'VACATION', antiguedad: { habilitado: false }, payload: { startDate: '2026-11-01', endDate: '2026-11-15' } }))
            .toMatch(/1 año/);
    });
    it('el motivo es obligatorio', () => {
        expect(motivoParaNoEnviar({ ...base, nota: ' ', tipo: 'ADVANCE', payload: { amount: 10 } })).toMatch(/motivo/);
        expect(motivoParaNoEnviar({ ...base, tipo: 'ADVANCE', payload: { amount: 10 } })).toBeNull();
    });
    it('una incapacidad nueva puede empezar el día que termina la anterior', () => {
        const solicitudes = [{ type: 'DISABILITY', status: 'APPROVED', metadata: { startDate: '2026-10-01', endDate: '2026-10-05' } }];
        const inc = incapacidadesVigentes(solicitudes, '2026-10-01');
        expect(choqueEnRango(inc, '2026-10-05', '2026-10-07')).toBeNull();
        expect(choqueEnRango(inc, '2026-10-04', '2026-10-07')).not.toBeNull();
        expect(motivoParaNoEnviar({ ...base, tipo: 'PERMIT', incapacidades: inc, payload: { permissionDates: ['2026-10-03'] } })).toMatch(/incapacidad/);
    });
    it('el compañero de vacaciones no puede cambiar turno', () => {
        expect(companeroNoDisponible([{ type: 'VACATION', date: '2026-10-01', metadata: { endDate: '2026-10-10' } }], '2026-10-04'))
            .toEqual({ motivo: 'de vacaciones' });
    });
});
