import { describe, it, expect } from 'vitest';
import {
    abonoQueYaEntro, decidirAprobacion, firmarLectura, revisarContraElSaldoVivo,
    verificarLectura, VIGENCIA_LECTURA_MS,
} from '../../supabase/functions/_shared/cobroCredito.ts';

// Un abono en la caja no se deshace: estas decisiones se prueban acá, con datos
// armados a mano, y nunca contra el origen.

describe('revisarContraElSaldoVivo — aprobar un cobro guardado (HA1)', () => {
    const vivos = new Map([
        ['A', { credito: 'A', saldo: 35.57 }],
        ['B', { credito: 'B', saldo: 0 }],
        ['C', { credito: 'C', saldo: 10 }],
    ]);

    it('deja pasar lo que cabe, al centavo', () => {
        const { aplicables, frenados } = revisarContraElSaldoVivo([{ credito: 'A', monto: 35.57 }], vivos);
        expect(aplicables).toHaveLength(1);
        expect(frenados).toHaveLength(0);
    });

    it('frena el crédito que ya se cobró por otro lado (el caso MAPFRE)', () => {
        const { aplicables, frenados } = revisarContraElSaldoVivo([{ credito: 'B', monto: 35.57 }], vivos);
        expect(aplicables).toHaveLength(0);
        expect(frenados[0].motivo).toMatch(/ahora debe 0\.00/);
    });

    it('frena el que bajó de saldo: no recorta el monto en silencio', () => {
        const { aplicables, frenados } = revisarContraElSaldoVivo([{ credito: 'C', monto: 20 }], vivos);
        expect(aplicables).toHaveLength(0);
        expect(frenados[0].motivo).toMatch(/debe 10\.00 y el cobro guardado es de 20\.00/);
    });

    it('frena el que ya no aparece en la caja', () => {
        const { frenados } = revisarContraElSaldoVivo([{ credito: 'Z', monto: 1 }], vivos);
        expect(frenados[0].motivo).toMatch(/ya no aparece/);
    });

    it('decide renglón por renglón', () => {
        const r = revisarContraElSaldoVivo(
            [{ credito: 'A', monto: 5 }, { credito: 'B', monto: 5 }, { credito: 'C', monto: 10 }], vivos);
        expect(r.aplicables.map((x) => x.credito)).toEqual(['A', 'C']);
        expect(r.frenados.map((x) => x.renglon.credito)).toEqual(['B']);
    });
});

describe('abonoQueYaEntro — retomar un envío que quedó a medias', () => {
    const abonos = [
        { erp_id: '10', fecha: '2026-10-20', forma: 'Transferencia', documento: 'ABC 123', monto: 20 },
        { erp_id: '11', fecha: '2026-10-23', forma: 'Transferencia', documento: 'ABC 123', monto: 20 },
        { erp_id: '12', fecha: '2026-10-23', forma: 'Efectivo', documento: null, monto: 15 },
    ];

    it('encuentra el abono del intento (mismo monto, forma, documento, desde el día del intento)', () => {
        expect(abonoQueYaEntro(abonos, { monto: 20, forma: 'Transferencia', documento: 'abc123', desde: '2026-10-23' })?.erp_id).toBe('11');
    });

    it('no confunde un abono anterior al intento', () => {
        expect(abonoQueYaEntro(abonos.slice(0, 1), { monto: 20, forma: 'Transferencia', documento: 'ABC 123', desde: '2026-10-23' })).toBeNull();
    });

    it('con otro documento no es el mismo abono', () => {
        expect(abonoQueYaEntro(abonos, { monto: 20, forma: 'Transferencia', documento: 'XYZ', desde: '2026-10-23' })).toBeNull();
    });

    it('efectivo sin documento: por monto, forma y fecha', () => {
        expect(abonoQueYaEntro(abonos, { monto: 15, forma: 'Efectivo', documento: '', desde: '2026-10-23' })?.erp_id).toBe('12');
        expect(abonoQueYaEntro(abonos, { monto: 15.01, forma: 'Efectivo', documento: '', desde: '2026-10-23' })).toBeNull();
    });

    it('un abono no lo reclaman dos renglones', () => {
        const usados = new Set(['11']);
        expect(abonoQueYaEntro(abonos, { monto: 20, forma: 'Transferencia', documento: 'ABC 123', desde: '2026-10-23' }, usados)).toBeNull();
    });
});

describe('la firma de la lectura del comprobante (HA5)', () => {
    const SECRETO = 'secreto-de-prueba';
    const base = { quien: 'emp-1', forma: 'transferencia', veredicto: 'OK', nombreSinReconocer: true };

    const lecturaFirmada = async (sobre = {}) => {
        const firma = await firmarLectura(SECRETO, { ...base, ...sobre });
        return { leido: {}, forma: sobre.forma ?? base.forma, veredicto: sobre.veredicto ?? base.veredicto,
                 nombreSinReconocer: sobre.nombreSinReconocer ?? base.nombreSinReconocer, firma };
    };

    it('una lectura firmada por el servidor se cree tal cual', async () => {
        const v = await verificarLectura(SECRETO, await lecturaFirmada(), 'emp-1', 'Transferencia');
        expect(v).toMatchObject({ valida: true, nombreSinReconocer: true, veredicto: 'OK' });
    });

    it('editar nombreSinReconocer en el navegador rompe la firma', async () => {
        const l = await lecturaFirmada();
        l.nombreSinReconocer = false;
        expect(await verificarLectura(SECRETO, l, 'emp-1', 'Transferencia')).toEqual({ valida: false, motivo: 'no_coincide' });
    });

    it('sin firma, vencida, de otra persona o de otra forma no vale', async () => {
        expect((await verificarLectura(SECRETO, { nombreSinReconocer: false }, 'emp-1', 'Transferencia')).motivo).toBe('sin_firma');
        expect((await verificarLectura(SECRETO, null, 'emp-1', 'Transferencia')).motivo).toBe('sin_firma');
        const vieja = await lecturaFirmada({ emitida: Date.now() - VIGENCIA_LECTURA_MS - 1000 });
        expect((await verificarLectura(SECRETO, vieja, 'emp-1', 'Transferencia')).motivo).toBe('vencida');
        expect((await verificarLectura(SECRETO, await lecturaFirmada(), 'emp-2', 'Transferencia')).motivo).toBe('no_coincide');
        const deTarjeta = await lecturaFirmada({ forma: 'tarjeta', nombreSinReconocer: false });
        expect((await verificarLectura(SECRETO, deTarjeta, 'emp-1', 'Transferencia')).motivo).toBe('otra_forma');
    });

    it('con otro secreto no coincide', async () => {
        expect((await verificarLectura('otro', await lecturaFirmada(), 'emp-1', 'Transferencia')).valida).toBe(false);
    });
});

describe('decidirAprobacion — la exigencia la decide el servidor', () => {
    const valida = (nombreSinReconocer) => ({ valida: true, nombreSinReconocer });
    const invalida = { valida: false, motivo: 'sin_firma' };

    it('transferencia con lectura firmada sin duda: no pide', () => {
        expect(decidirAprobacion({ forma: 'Transferencia', pideElNavegador: false, lectura: valida(false) }).pide).toBe(false);
    });

    it('beneficiario sin reconocer: pide, aunque el navegador diga que no', () => {
        const d = decidirAprobacion({ forma: 'Transferencia', pideElNavegador: false, lectura: valida(true) });
        expect(d).toMatchObject({ pide: true, porBeneficiario: true });
    });

    it('lectura sin firma válida: pide (el cobro no se pierde, espera firma)', () => {
        const d = decidirAprobacion({ forma: 'Cheque', pideElNavegador: false, lectura: invalida });
        expect(d).toMatchObject({ pide: true, porLecturaSinFirma: true });
    });

    it('«Otro» siempre pide; el navegador sólo puede SUMAR', () => {
        expect(decidirAprobacion({ forma: 'Otro', pideElNavegador: false, lectura: invalida }).pide).toBe(true);
        expect(decidirAprobacion({ forma: 'Tarjeta', pideElNavegador: true, lectura: valida(false) }).pide).toBe(true);
    });

    it('el efectivo no tiene papel: sin lectura no se inventa una duda', () => {
        expect(decidirAprobacion({ forma: 'Efectivo', pideElNavegador: false, lectura: invalida }).pide).toBe(false);
    });
});
