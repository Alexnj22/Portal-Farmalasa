// Contrato vencido y contrato nuevo (2026-11-20): el interinato que venció el
// 18 de noviembre y siguió con otro desde el 23.
import { describe, it, expect } from 'vitest';
import {
    contratoVencido, contratosVencidos, diasSinContrato, faltaParaRecontratar,
    contratoNuevoInicial, avisoDeContratoNuevo,
} from '@nucleo/utils/reingresoYRecontratacion';
import { liquidacionEstimada, respaldoDeBajaObligatorio, cierrePendienteDeBaja, avisosDeBaja } from '@nucleo/utils/bajaLegal';

const HOY = '2026-11-20';
const interino = {
    id: 'r', name: 'R', status: 'ACTIVO', contract_type: 'TEMPORAL', contract_end_date: '2026-11-18',
    branch_id: 29, role_id: 23, secondary_role_id: 30, weekly_contracted_hours: 40,
    contract_temporal_legal_basis: 'TRANSITORIO_EVENTUAL', contract_temporal_reason: 'INTERINATO',
};
const form = (ingreso) => ({ rehire_hire_date: ingreso, rehire_branch_id: '29', rehire_role_id: '23', rehire_contract_type: 'INDEFINIDO', rehire_weekly_hours: '44' });

describe('contratoVencido', () => {
    it('activo con temporal vencido → la fecha de fin', () => {
        expect(contratoVencido(interino, HOY)).toBe('2026-11-18');
    });
    it('vence hoy o después → null', () => {
        expect(contratoVencido({ ...interino, contract_end_date: HOY }, HOY)).toBeNull();
        expect(contratoVencido({ ...interino, contract_end_date: '2026-12-01' }, HOY)).toBeNull();
    });
    it('indefinido, de baja o sin fecha → null', () => {
        expect(contratoVencido({ ...interino, contract_type: 'INDEFINIDO' }, HOY)).toBeNull();
        expect(contratoVencido({ ...interino, status: 'INACTIVO' }, HOY)).toBeNull();
        expect(contratoVencido({ ...interino, contract_end_date: null }, HOY)).toBeNull();
    });
});

describe('contratosVencidos', () => {
    it('sólo los vencidos, del más viejo al más nuevo, con los días', () => {
        const filas = contratosVencidos([
            { ...interino, id: 'b', contract_end_date: '2026-11-18' },
            { ...interino, id: 'a', contract_end_date: '2026-11-01' },
            { ...interino, id: 'c', contract_end_date: '2026-12-31' },
        ], HOY);
        expect(filas.map(f => f.emp.id)).toEqual(['a', 'b']);
        expect(filas[1].diasVencido).toBe(2);
    });
});

describe('diasSinContrato y faltaParaRecontratar', () => {
    it('del 18 al 23 quedan 4 días sin contrato', () => {
        expect(diasSinContrato('2026-11-18', '2026-11-23')).toBe(4);
    });
    it('al día siguiente es prórroga, antes es imposible', () => {
        expect(faltaParaRecontratar(form('2026-11-19'), interino)).toMatch(/prórroga/);
        expect(faltaParaRecontratar(form('2026-11-18'), interino)).toMatch(/después/);
        expect(faltaParaRecontratar(form('2026-11-23'), interino)).toBeNull();
    });
    it('sin el empleado se comporta como antes', () => {
        expect(faltaParaRecontratar(form('2026-11-19'))).toBeNull();
    });
});

describe('contratoNuevoInicial y su aviso', () => {
    it('propone el mismo contrato, sucursal, cargo y horas', () => {
        const f = contratoNuevoInicial(interino, HOY);
        expect(f).toMatchObject({
            rehire_hire_date: HOY, rehire_contract_type: 'TEMPORAL', rehire_weekly_hours: '40',
            rehire_branch_id: 29, rehire_role_id: 23, rehire_secondary_role_id: 30,
            rehire_temporal_legal_basis: 'TRANSITORIO_EVENTUAL', rehire_temporal_reason: 'INTERINATO',
        });
    });
    it('dice cuándo terminó y cuántos días quedan sin contrato', () => {
        expect(avisoDeContratoNuevo(interino, '2026-11-23', HOY)).toMatch(/18 de noviembre.*4 días sin contrato/);
        expect(avisoDeContratoNuevo({ ...interino, contract_end_date: '2026-12-01' }, '2026-12-05', HOY)).toBeNull();
    });
});

describe('baja por fin del plazo', () => {
    it('no exige respaldo: el contrato ya está en el expediente', () => {
        expect(respaldoDeBajaObligatorio('VENCIMIENTO_PLAZO')).toBe(false);
        expect(respaldoDeBajaObligatorio('RENUNCIA')).toBe(true);
    });
    it('los proporcionales quedan para revisar, sin sumarse al total', () => {
        const l = liquidacionEstimada({ motivo: 'VENCIMIENTO_PLAZO', salarioMensual: 450, ingreso: '2026-10-19', baja: '2026-11-18', salarioMinimoMensual: 408.8 });
        expect(l.rubros.find(r => r.clave === 'vacaciones').aplica).toBe('revisar');
        expect(l.rubros.find(r => r.clave === 'aguinaldo').aplica).toBe('revisar');
        expect(l.total).toBe(0);
    });
    it('el fin de un contrato que siguió con otro no tiene cierre pendiente', () => {
        expect(cierrePendienteDeBaja({ motivo: 'VENCIMIENTO_PLAZO', porContratoNuevo: true })).toEqual([]);
        expect(cierrePendienteDeBaja({ motivo: 'VENCIMIENTO_PLAZO' }).length).toBeGreaterThan(0);
    });
    it('avisa si la baja es después del vencimiento o el contrato no tiene plazo', () => {
        expect(avisosDeBaja({ terminationReason: 'VENCIMIENTO_PLAZO', date: '2026-11-20' }, interino).join(' ')).toMatch(/Art\. 25/);
        expect(avisosDeBaja({ terminationReason: 'VENCIMIENTO_PLAZO', date: '2026-11-18' }, { ...interino, contract_type: 'INDEFINIDO' }).join(' ')).toMatch(/no tiene plazo/);
        expect(avisosDeBaja({ terminationReason: 'VENCIMIENTO_PLAZO', date: '2026-11-18' }, interino)).toEqual([]);
    });
});
