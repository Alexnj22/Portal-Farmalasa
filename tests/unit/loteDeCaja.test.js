import { describe, it, expect } from 'vitest';
import {
    lotesConocidosDeInventario, motivoDeLoteDeCaja, loteDeCajaParaEnviar, choqueDeLote,
} from '@nucleo/utils/loteDeCaja';

const HOY = '2026-11-05';
const FILAS = [
    { lote: 'A1', fecha_vencimiento: '2028-03-01', erp_sucursal_id: 1 },
    { lote: 'A1', fecha_vencimiento: '2028-03-01', erp_sucursal_id: 2 },
    { lote: 'B7', fecha_vencimiento: '2027-12-15', erp_sucursal_id: 3 },
    { lote: 'GENERICO', fecha_vencimiento: '2030-01-01', erp_sucursal_id: 1 },
    { lote: 'VIEJO', fecha_vencimiento: '2026-01-01', erp_sucursal_id: 1 },
];
const CONOCIDOS = lotesConocidosDeInventario(FILAS, HOY);

describe('lotes ya registrados', () => {
    it('uno por número + fecha, sin GENERICO ni vencidos, con cuántas salas', () => {
        expect(CONOCIDOS).toEqual([
            { lote: 'B7', vence: '2027-12', fecha: '2027-12-15', veces: 1 },
            { lote: 'A1', vence: '2028-03', fecha: '2028-03-01', veces: 2 },
        ]);
    });
});

describe('lo que se manda', () => {
    it('un lote registrado viaja con SU fecha exacta, aunque no sea día 1', () => {
        expect(loteDeCajaParaEnviar({ lote: 'b7', vence: '2027-12' }, CONOCIDOS)).toEqual({ lote: 'B7', vence: '2027-12-15' });
    });
    it('uno nuevo viaja con el día 1 del mes', () => {
        expect(loteDeCajaParaEnviar({ lote: 'Z9', vence: '2029-06' }, CONOCIDOS)).toEqual({ lote: 'Z9', vence: '2029-06-01' });
    });
});

describe('por qué no se puede', () => {
    it('falta lote, GENERICO o vencimiento', () => {
        expect(motivoDeLoteDeCaja({ lote: '', vence: '2029-01' }, [], HOY)).toMatch(/Falta el lote/);
        expect(motivoDeLoteDeCaja({ lote: 'GENERICO', vence: '2029-01' }, [], HOY)).toMatch(/Falta el lote/);
        expect(motivoDeLoteDeCaja({ lote: 'Z9', vence: '' }, [], HOY)).toMatch(/Falta el vencimiento/);
    });
    it('vencida o de este mes no sale', () => {
        expect(motivoDeLoteDeCaja({ lote: 'Z9', vence: '2026-11' }, [], HOY)).toMatch(/venció/);
    });
    it('mismo número con otro mes: frena y no se destraba con «es otro»', () => {
        expect(motivoDeLoteDeCaja({ lote: 'A1', vence: '2029-03' }, CONOCIDOS, HOY)).toMatch(/ya está registrado/);
        expect(choqueDeLote({ lote: 'A1', vence: '2029-03', nuevo: true }, CONOCIDOS)?.mismoNumero).toBe(true);
    });
    it('parecido por tecleo: frena hasta confirmar que es otro', () => {
        expect(motivoDeLoteDeCaja({ lote: 'B 7', vence: '2027-12' }, CONOCIDOS, HOY)).toMatch(/¿Es el lote B7\?/);
        expect(motivoDeLoteDeCaja({ lote: 'B 7', vence: '2027-12', nuevo: true }, CONOCIDOS, HOY)).toBeNull();
    });
    it('el registrado tal cual: pasa', () => {
        expect(motivoDeLoteDeCaja({ lote: 'A1', vence: '2028-03' }, CONOCIDOS, HOY)).toBeNull();
    });
});

describe('vence de la caja y qué falta (2026-11-13)', () => {
    it('motivoDeVenceDeCaja: vacío, mal escrito, vencido y bueno', async () => {
        const { motivoDeVenceDeCaja, venceDeCajaParaEnviar } = await import('@nucleo/utils/loteDeCaja');
        expect(motivoDeVenceDeCaja({ vence: '' }, '2026-11-13')).toMatch(/Falta/);
        expect(motivoDeVenceDeCaja({ vence: '13/2027' }, '2026-11-13')).toMatch(/MM\/AAAA/);
        expect(motivoDeVenceDeCaja({ vence: '2026-11' }, '2026-11-13')).toMatch(/venció/);
        expect(motivoDeVenceDeCaja({ vence: '05/2028' }, '2026-11-13')).toBeNull();
        expect(venceDeCajaParaEnviar({ vence: '05/2028' })).toEqual({ lote: '', vence: '2028-05-01' });
    });
    it('faltaDeLaCaja: regulado pide lote por lo GENERICO; perecedero pide vence por lo sin fecha', async () => {
        const { faltaDeLaCaja } = await import('@nucleo/utils/loteDeCaja');
        const reparto = [
            { lote: '261050', vence: '2028-10-01', toma: 2 },
            { lote: 'GENERICO', vence: '', toma: 1 },
        ];
        expect(faltaDeLaCaja({ regulado: true, perecedero: true }, reparto)).toEqual({ pide: 'lote', unidades: 1 });
        expect(faltaDeLaCaja({ regulado: false, perecedero: true }, [{ lote: null, vence: null, toma: 3 }])).toEqual({ pide: 'vence', unidades: 3 });
        expect(faltaDeLaCaja({ regulado: false, perecedero: true }, [{ lote: null, vence: '2028-01-01', toma: 3 }])).toEqual({ pide: null, unidades: 0 });
        expect(faltaDeLaCaja({ regulado: false, perecedero: false }, [{ lote: null, vence: null, toma: 3 }])).toEqual({ pide: null, unidades: 0 });
        expect(faltaDeLaCaja(null, reparto)).toEqual({ pide: null, unidades: 0 });
    });
});
