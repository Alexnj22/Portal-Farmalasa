import { describe, it, expect } from 'vitest';
import { admiteProrroga, opcionesDeNovedad, validarNovedad } from '@nucleo/utils/novedadDePersonal';
import { hoySV } from '@nucleo/utils/fecha';

// La prórroga como acción de personal (2026-11-20).
const temporal = { status: 'ACTIVO', contract_type: 'TEMPORAL', contract_end_date: '2026-11-18', contrato_prorrogas: [] };
const base = { type: 'CONTRACT_EXTENSION', date: hoySV(), newEndDate: '2027-02-18', note: 'Cubre la temporada' };

describe('prórroga de contrato', () => {
    it('sólo se ofrece a quien tiene un contrato con plazo y sigue trabajando', () => {
        expect(admiteProrroga(temporal)).toBe(true);
        expect(admiteProrroga({ ...temporal, contract_type: 'SERVICIOS' })).toBe(true);
        expect(admiteProrroga({ ...temporal, contract_type: 'INDEFINIDO' })).toBe(false);
        expect(admiteProrroga({ ...temporal, status: 'INACTIVO' })).toBe(false);
        expect(admiteProrroga({ ...temporal, contract_end_date: null })).toBe(false);
        const tiene = (emp) => opcionesDeNovedad(emp).some((o) => o.value === 'CONTRACT_EXTENSION');
        expect(tiene(temporal)).toBe(true);
        expect(tiene({ ...temporal, contract_type: 'INDEFINIDO' })).toBe(false);
        expect(tiene(undefined)).toBe(false);
    });
    it('pide un nuevo fin posterior al vigente, una fecha no futura y el motivo', () => {
        expect(validarNovedad({ formData: base, empleado: temporal }).ok).toBe(true);
        expect(validarNovedad({ formData: { ...base, newEndDate: null }, empleado: temporal }).ok).toBe(false);
        expect(validarNovedad({ formData: { ...base, newEndDate: '2026-11-18' }, empleado: temporal }).motivo).toMatch(/después del/);
        expect(validarNovedad({ formData: { ...base, date: '2099-01-01' }, empleado: temporal }).motivo).toMatch(/futura/);
        expect(validarNovedad({ formData: { ...base, note: '' }, empleado: temporal }).ok).toBe(false);
        expect(validarNovedad({ formData: base, empleado: { ...temporal, contract_type: 'INDEFINIDO' } }).motivo).toMatch(/temporal o de servicios/);
    });
    it('al corregir no se compara contra su propio fin', () => {
        const yaProrrogado = { ...temporal, contract_end_date: '2027-02-18' };
        expect(validarNovedad({ formData: { ...base, newEndDate: '2027-01-31', _editingEventId: 'x' }, empleado: yaProrrogado }).ok).toBe(true);
    });
});
