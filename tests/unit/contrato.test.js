// ─────────────────────────────────────────────────────────────────────────────
// Las reglas del contrato — sobre todo cuándo NO aplican
// ─────────────────────────────────────────────────────────────────────────────
//
// La prueba que más importa acá es que un contrato de servicios profesionales
// NO tenga plazo con el Ministerio de Trabajo. Devolverle «te quedan 8 días»
// sería inventar una obligación que no existe: el Art. 18 es para contratos DE
// TRABAJO, y un contrato de servicios profesionales es civil.

import { describe, it, expect } from 'vitest';
import { estadoRemisionMtps, esContratoCivil, PLAZO_MTPS_DIAS, PLAZO_DE_PAGO } from '../../src/utils/contrato';

const HOY = new Date(2026, 7, 26);   // 26-ago-2026, hora local

describe('estadoRemisionMtps', () => {
    it('no aplica a servicios profesionales: es un contrato civil', () => {
        const r = estadoRemisionMtps(
            { contract_type: 'SERVICIOS', contrato_fecha_celebracion: '2026-08-20' }, HOY);
        expect(r.aplica).toBe(false);
        expect(r.motivo).toContain('civil');
        expect(r.diasRestantes).toBeUndefined();
    });

    it('no aplica sin fecha de firma: el plazo cuenta desde la celebración', () => {
        const r = estadoRemisionMtps({ contract_type: 'INDEFINIDO' }, HOY);
        expect(r.aplica).toBe(false);
    });

    it('cuenta ocho días desde la firma', () => {
        const r = estadoRemisionMtps(
            { contract_type: 'INDEFINIDO', contrato_fecha_celebracion: '2026-08-26' }, HOY);
        expect(r.aplica).toBe(true);
        expect(r.diasRestantes).toBe(PLAZO_MTPS_DIAS);
        expect(r.vencido).toBe(false);
        expect(r.limite).toBe('2026-09-03');
    });

    it('marca vencido cuando pasaron más de ocho días', () => {
        const r = estadoRemisionMtps(
            { contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-08-10' }, HOY);
        expect(r.vencido).toBe(true);
        expect(r.diasRestantes).toBeLessThan(0);
    });

    it('si ya se remitió, no hay cuenta regresiva', () => {
        const r = estadoRemisionMtps({
            contract_type: 'INDEFINIDO',
            contrato_fecha_celebracion: '2026-08-10',
            mtps_remitido_fecha: '2026-08-12',
        }, HOY);
        expect(r.remitido).toBe(true);
        expect(r.vencido).toBeUndefined();
    });

    it('la fecha no retrocede un día por leerse como UTC', () => {
        // `new Date('2026-08-26')` cae el 25 por la tarde en El Salvador. Con el
        // constructor por partes, el límite es el 3 de septiembre y no el 2.
        const r = estadoRemisionMtps(
            { contract_type: 'INDEFINIDO', contrato_fecha_celebracion: '2026-08-26' }, HOY);
        expect(r.limite).toBe('2026-09-03');
    });
});

describe('esContratoCivil', () => {
    it('sólo servicios profesionales', () => {
        expect(esContratoCivil('SERVICIOS')).toBe(true);
        expect(esContratoCivil('INDEFINIDO')).toBe(false);
        expect(esContratoCivil('TEMPORAL')).toBe(false);
    });
});

describe('PLAZO_DE_PAGO', () => {
    it('cada forma de estipulación tiene su plazo del Art. 130', () => {
        // Es lo que vuelve la estipulación una decisión y no un desplegable más.
        expect(PLAZO_DE_PAGO.TIEMPO).toContain('período');
        expect(PLAZO_DE_PAGO.OBRA).toContain('dos días');
        expect(PLAZO_DE_PAGO.COMISION).toContain('quince días');
    });
});
