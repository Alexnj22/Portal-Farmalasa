import { describe, it, expect } from 'vitest';
import { cuentaDeResolucion, propuestaDeResponsables } from '@nucleo/utils/diferenciasDeCaja';
import { accionDeLaCaja, bolsasDelDia, declaradoDelCorte, embolsadoDelDia, valesDeLaSala } from '@nucleo/utils/corteDeCaja';

describe('corteDeCaja', () => {
    it('Salud 5, 1-sep: el corte de la tarde declara cajón + lo embolsado (por SALDO)', () => {
        const bolsas = [
            { fecha: '2026-09-01', saldo: 488.63 },
            { fecha: '2026-08-31', saldo: 100 },
            { fecha: '2026-09-01', saldo: '240.22' },
        ];
        const hoy = bolsasDelDia(bolsas, '2026-09-01');
        expect(hoy).toHaveLength(2);
        expect(embolsadoDelDia(hoy)).toBeCloseTo(728.85, 2);
        expect(declaradoDelCorte('88.10', embolsadoDelDia(hoy))).toBeCloseTo(816.95, 2);
        expect(bolsasDelDia(bolsas, null)).toEqual([]);
    });

    it('vales de la sala', () => {
        expect(valesDeLaSala([{ branch_id: 3 }, { branch_id: '4' }], '3')).toHaveLength(1);
    });

    it('qué acción ofrece la caja', () => {
        const base = { puedeOperar: true, sala: '3', noSePudo: null };
        expect(accionDeLaCaja({ ...base, puedeOperar: false, estado: { abierta: true } })).toBeNull();
        expect(accionDeLaCaja({ ...base, noSePudo: 'x', estado: { abierta: false } })).toBeNull();
        expect(accionDeLaCaja({ ...base, estado: null })).toBeNull();
        expect(accionDeLaCaja({ ...base, estado: { abierta: false, cortes: [] } })).toBe('abrir');
        expect(accionDeLaCaja({ ...base, estado: { abierta: false, cortes: [{ tipo: 'Z' }] } })).toBe('cerrada-dia');
        expect(accionDeLaCaja({ ...base, estado: { abierta: true, turno_corriendo: false } })).toBe('iniciar-turno');
        expect(accionDeLaCaja({ ...base, estado: { abierta: true } })).toBe('operar');
        expect(accionDeLaCaja({ ...base, estado: { abierta: true, turno_corriendo: true } })).toBe('operar');
    });
});


describe('resolver una diferencia', () => {
    it('propone a quien vendió; si nadie, al turno o a quien resuelve', () => {
        expect(propuestaDeResponsables([{ id: 1, ventas: 0 }, { id: 2, ventas: 3 }], 9)).toEqual([2]);
        expect(propuestaDeResponsables([{ id: 1, ventas: 0, del_turno: true }, { id: 9 }], 9)).toEqual([1, 9]);
        expect(propuestaDeResponsables([{ id: 4 }, { id: 5 }], 9)).toEqual([4]);
        expect(propuestaDeResponsables([], 9)).toEqual([]);
    });
    it('la causa explica todo o una parte, y exige comprobante', () => {
        const base = { via: 'JUSTIFICA', pendiente: 20, causa: 'venta con tarjeta' };
        expect(cuentaDeResolucion(base).faltaComprobante).toBe(true);
        const r = cuentaDeResolucion({ ...base, evidenciaRef: 'F-1', montoCausa: '5' });
        expect(r.faltaGuardar).toBe(false);
        expect(r.montoExplica).toBe(5);
        expect(r.quedaTrasCausa).toBe(15);
        expect(cuentaDeResolucion({ ...base, conFoto: true, montoCausa: '0' }).explicaInvalido).toBe(true);
    });
    it('los responsables tienen que sumar exacto', () => {
        const base = { via: 'REPONE', pendiente: 10, causa: 'se revisó' };
        expect(cuentaDeResolucion({ ...base, aportes: [5, 4.99] }).faltaGuardar).toBe(true);
        expect(cuentaDeResolucion({ ...base, aportes: [5, 5] }).faltaGuardar).toBe(false);
        expect(cuentaDeResolucion({ ...base, aportes: [] }).faltaGuardar).toBe(true);
    });
});
