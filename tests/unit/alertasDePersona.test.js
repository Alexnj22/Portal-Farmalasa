import { describe, it, expect } from 'vitest';
import { alertasDePersona, finDeContrato } from '@nucleo/utils/alertasDePersona';

// El contrato a plazo que vence sin que nadie lo vea (2026-11-20).
const richard = { status: 'ACTIVO', contract_type: 'TEMPORAL', contract_end_date: '2026-11-18' };

describe('finDeContrato', () => {
    it('avisa el contrato vencido de alguien activo', () => {
        expect(finDeContrato(richard, '2026-11-20')).toEqual({ dias: -2, fin: '2026-11-18' });
        const a = alertasDePersona(richard, '2026-11-20').find((x) => x.key === 'contrato');
        expect(a.texto).toBe('Contrato vencido');
        expect(a.variante).toBe('danger');
    });
    it('avisa desde 30 días antes, no antes', () => {
        expect(finDeContrato(richard, '2026-10-19')?.dias).toBe(30);
        expect(finDeContrato(richard, '2026-10-18')).toBeNull();
        expect(alertasDePersona(richard, '2026-11-18').find((x) => x.key === 'contrato').texto).toBe('Contrato vence hoy');
    });
    it('no avisa indefinidos, bajas ni contratos sin fecha', () => {
        expect(finDeContrato({ ...richard, contract_type: 'INDEFINIDO' }, '2026-11-20')).toBeNull();
        expect(finDeContrato({ ...richard, status: 'INACTIVO' }, '2026-11-20')).toBeNull();
        expect(finDeContrato({ ...richard, contract_end_date: null }, '2026-11-20')).toBeNull();
    });
    it('la prórroga apaga el aviso (sube la fecha de fin)', () => {
        expect(finDeContrato({ ...richard, contract_end_date: '2027-02-18' }, '2026-11-20')).toBeNull();
    });
});
