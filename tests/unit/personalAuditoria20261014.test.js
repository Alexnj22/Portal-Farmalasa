// Auditoría de Personal 2026-10-14 — docs/PLAN-PERSONAL-AUDITORIA-2026-10-14.md
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { eventoVigente, esSancion, soporteDe } from '@nucleo/utils/historialDeFicha';
import { faltaParaRecontratar, recontratacionCompleta, datosDeRecontratacion, horasValidas } from '@nucleo/utils/reingresoYRecontratacion';
import { SENSITIVE_FIELDS } from '@nucleo/store/utils';
import { tablaDelDirectorio } from '@nucleo/utils/directorioCsv';

describe('S3 · una sanción no se corrige ni se cancela desde el historial', () => {
    const base = { eventoId: 'e1', isSystem: false, metadata: {} };
    it.each(['AMONESTACION_VERBAL', 'AMONESTACION_ESCRITA', 'SUSPENSION', 'RECTIFICACION'])('%s no es vigente para editar', (type) => {
        expect(esSancion({ type })).toBe(true);
        expect(eventoVigente({ ...base, type })).toBe(false);
    });
    it('una novedad común sí', () => {
        expect(eventoVigente({ ...base, type: 'VACATION' })).toBe(true);
    });
});

describe('E6 · el soporte se encuentra por event_id', () => {
    const ev = { eventoId: 'ev-9', documentId: null };
    it('encuentra el documento subido con el evento', () => {
        const docs = [{ id: 'd1', event_id: 'otro', url: 'u1' }, { id: 'd2', event_id: 'ev-9', url: 'u2' }];
        expect(soporteDe(ev, docs)?.id).toBe('d2');
    });
    it('sin documento, null', () => {
        expect(soporteDe(ev, [])).toBeNull();
        expect(soporteDe(ev, [{ id: 'd3', event_id: 'ev-9' }])).toBeNull(); // sin url no es un soporte
    });
});

describe('E5/V3 · la recontratación a plazo pide su respaldo', () => {
    const ok = { rehire_hire_date: '2026-10-14', rehire_branch_id: 4, rehire_role_id: 7, rehire_weekly_hours: '44' };
    it('indefinido con lo básico está completo', () => {
        expect(faltaParaRecontratar(ok)).toBeNull();
    });
    it('temporal sin fecha de fin, base ni motivo no', () => {
        const t = { ...ok, rehire_contract_type: 'TEMPORAL' };
        expect(faltaParaRecontratar(t)).toMatch(/fecha de fin/);
        expect(faltaParaRecontratar({ ...t, rehire_contract_end_date: '2026-10-01' })).toMatch(/posterior/);
        expect(faltaParaRecontratar({ ...t, rehire_contract_end_date: '2027-01-01' })).toMatch(/Art\. 25/);
        expect(recontratacionCompleta({ ...t, rehire_contract_end_date: '2027-01-01', rehire_temporal_legal_basis: 'TRANSITORIO_EVENTUAL', rehire_temporal_reason: 'Cobertura' })).toBe(true);
    });
    it('las horas van de 1 a 44', () => {
        expect(horasValidas('60')).toBe(false);
        expect(horasValidas('-5')).toBe(false);
        expect(horasValidas('22')).toBe(true);
        expect(faltaParaRecontratar({ ...ok, rehire_weekly_hours: '60' })).toMatch(/1 a 44/);
    });
    it('el respaldo viaja al store', () => {
        const d = datosDeRecontratacion({ ...ok, rehire_contract_type: 'TEMPORAL', rehire_contract_end_date: '2027-01-01', rehire_temporal_legal_basis: 'X', rehire_temporal_reason: ' y ' });
        expect(d).toMatchObject({ contract_end_date: '2027-01-01', contract_temporal_legal_basis: 'X', contract_temporal_reason: 'y' });
    });
});

describe('S4/S5 · el código de carné (= contraseña) no sale', () => {
    it('no está en el CSV del directorio, tenga el permiso que tenga', () => {
        const { headers } = tablaDelDirectorio([{ id: 1, code: '1234', name: 'X', status: 'ACTIVO', tipo_ficha: 'empleado' }], new Map(), { identidad: true, credenciales: true });
        expect(headers).not.toContain('Código');
    });
    it('no se guarda en el borrador ni en el padrón cacheado', () => {
        expect(SENSITIVE_FIELDS).toContain('code');
    });
});

describe('las reglas que viven en el código del store', () => {
    const slice = readFileSync('src/store/slices/employeeSlice.js', 'utf8');
    const system = readFileSync('src/store/slices/systemSlice.js', 'utf8');
    it('V1 · el DUI se exige sólo en el alta', () => {
        expect(slice).toMatch(/if \(esAlta && \(data\.dui !== undefined/);
        expect(slice).toMatch(/validateOptionalFormats\(formData, \{ esAlta: true \}\)/);
    });
    it('V2 · el NUP usa revisarNup, no 12 dígitos fijos', () => {
        expect(slice).not.toMatch(/\['afp_number', 12/);
        expect(slice).toMatch(/revisarNup\(data\.afp_number/);
    });
    it('D2 · editar crea la corrección ANTES de reemplazar la original', () => {
        const i = system.indexOf('editEmployeeEvent: async');
        const cuerpo = system.slice(i, i + 3000);
        expect(cuerpo.indexOf('registerEmployeeEvent(')).toBeLessThan(cuerpo.indexOf("status: 'SUPERSEDED'"));
    });
    it('D1 · cancelar lee el sueldo y el código por su canal', () => {
        expect(system).toMatch(/fetchSalarios\(\[id\], \{ lanzar: true \}\)/);
        expect(system).toMatch(/fetchCredenciales\(\[id\], \{ lanzar: true \}\)/);
    });
    it('D6 · nadie le pone .catch a functions.invoke de la cuenta', () => {
        expect(system + slice).not.toMatch(/invoke\('disable-employee-auth'[\s\S]{0,120}\}\)\.catch/);
    });
});

describe('los tres pendientes que quedaron del plan', () => {
    const system = readFileSync('src/store/slices/systemSlice.js', 'utf8');
    it('una novedad de sueldo sin monto válido se rechaza', () => {
        expect(system).toMatch(/if \(!\(newSalary > 0\)\) \{\s*throw usuario\(/);
    });
    it('la sanción nueva entra a la copia en memoria', () => {
        expect(system).toMatch(/traerEventoAlHistorial: async/);
        expect(readFileSync('src/components/personal/SancionModal.jsx', 'utf8')).toMatch(/onGuardado\?\.\(eventoId\)/);
    });
    it('Servicios pide fecha de fin, pero no base legal', () => {
        const base = { rehire_hire_date: '2026-10-14', rehire_branch_id: 4, rehire_role_id: 7, rehire_contract_type: 'SERVICIOS' };
        expect(faltaParaRecontratar(base)).toMatch(/fecha de fin/);
        expect(faltaParaRecontratar({ ...base, rehire_contract_end_date: '2027-01-01' })).toBeNull();
    });
});
