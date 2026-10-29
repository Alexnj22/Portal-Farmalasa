import { describe, expect, it } from 'vitest';
import { esInmuebleAlquilado, estadoDeServicio, serviciosDeSucursal } from '@nucleo/utils/gastosDeSucursal';
import {
    alertaDelExpediente, documentosDeSucursal, estadoDeDocumento, filasDeEnfermeria, personalNormativoDeSucursal,
} from '@nucleo/utils/expedienteDeSucursal';
import { idsDeEnfermeria } from '@nucleo/utils/edicionDeSucursal';

describe('gastos: enero mira a diciembre del año anterior', () => {
    const enero = new Date(2027, 0, 5); // 5 de enero de 2027
    it('pagado hasta diciembre, antes del día de pago → vence pronto, no vencido', () => {
        expect(estadoDeServicio(10, '2026-12', false, enero).state).toBe('pending');
    });
    it('pagado hasta diciembre, pasado el día de pago → vencido', () => {
        expect(estadoDeServicio(3, '2026-12', false, enero).state).toBe('expired');
    });
    it('pagado hasta noviembre → vencido', () => {
        expect(estadoDeServicio(10, '2026-11', false, enero).state).toBe('expired');
    });
    it('pagado hasta enero o adelantado → al día', () => {
        expect(estadoDeServicio(10, '2027-01', false, enero).state).toBe('paid');
        expect(estadoDeServicio(10, '2027-03', false, enero).state).toBe('paid');
    });
});

describe('alquilada: RENTED y ALQUILADO valen lo mismo', () => {
    it.each([
        [{ propertyType: 'RENTED' }, true],
        [{ propertyType: 'ALQUILADO' }, true],
        [{ settings: { propertyType: 'ALQUILADO' } }, true],
        [{ settings: { propertyType: 'RENTED' } }, true],
        [{ propertyType: 'OWNED' }, false],
        [{}, false],
    ])('%j → %s', (b, esperado) => {
        expect(esInmuebleAlquilado(b)).toBe(esperado);
    });
    it('el arrendamiento aparece con ALQUILADO', () => {
        const b = { type: 'FARMACIA', propertyType: 'ALQUILADO', settings: {} };
        expect(serviciosDeSucursal(b).map((x) => x.clave)).toContain('rent');
    });
});

describe('vencimiento en días de El Salvador', () => {
    // 18:30 del 29-oct en la sala = 00:30 UTC del 30-oct.
    const tardeDel29 = new Date('2026-10-30T00:30:00Z');
    it('un permiso que vence el 30 no está vencido la tarde del 29', () => {
        const e = estadoDeDocumento('u', '2026-10-30', tardeDel29);
        expect(e.type).toBe('WARNING');
        expect(e.dias).toBe(1);
    });
    it('el día del vencimiento todavía vale; el siguiente ya no', () => {
        const dia30 = new Date('2026-10-30T20:00:00Z'); // 14:00 SV
        expect(estadoDeDocumento('u', '2026-10-30', dia30).dias).toBe(0);
        expect(estadoDeDocumento('u', '2026-10-29', dia30).type).toBe('EXPIRED');
    });
    it('una fecha inválida no inventa un estado', () => {
        expect(estadoDeDocumento('u', 'no-es-fecha', tardeDel29).type).toBe('OK');
    });
});

describe('enfermería: una sola lectura', () => {
    it('nursingRegents manda; si falta, se arma desde nurses', () => {
        expect(filasDeEnfermeria({ nursingRegents: [{ employeeId: 7 }] }).map((f) => f.employeeId)).toEqual([7]);
        expect(filasDeEnfermeria({ nurses: [3, '', null, 4] }).map((f) => f.employeeId)).toEqual([3, 4]);
        expect(filasDeEnfermeria({})).toEqual([]);
    });
    it('coincide con idsDeEnfermeria', () => {
        for (const legal of [{ nursingRegents: [{ employeeId: 1 }, { employeeId: 2 }] }, { nurses: [5, 6] }, {}]) {
            const ids = filasDeEnfermeria(legal).map((f) => f.employeeId).filter((v) => v != null && v !== '');
            expect(ids).toEqual(idsDeEnfermeria(legal));
        }
    });
    it('el expediente muestra los renglones de una sala que sólo tiene nurses', () => {
        const b = { settings: { legal: { injections: true, nurses: [9] } } };
        expect(documentosDeSucursal(b).personal.map((d) => d.id)).toContain('nurse_carne_0');
    });
});

describe('personal normativo: la baja no cuenta como asignada', () => {
    const empleados = [
        { id: 1, name: 'REGENTE ACTIVA', status: 'ACTIVO' },
        { id: 2, name: 'REFERENTE DE BAJA', status: 'INACTIVO' },
        { id: 3, name: 'ENFERMERA', status: 'ACTIVO' },
        { id: 4, name: 'ENFERMERO DE BAJA', status: 'inactivo' },
    ];
    it('regente activo sí, referente de baja no', () => {
        const r = personalNormativoDeSucursal({ regentEmployeeId: 1, pharmacovigilanceEmployeeId: 2 }, empleados);
        expect(r.regente?.id).toBe(1);
        expect(r.referente).toBeNull();
    });
    it('el referente viejo (`farmacovigilanciaId`) también se lee', () => {
        expect(personalNormativoDeSucursal({ farmacovigilanciaId: 1 }, empleados).referente?.id).toBe(1);
    });
    it('enfermería: sólo los activos, con el índice de su fila', () => {
        const r = personalNormativoDeSucursal({ nursingRegents: [{ employeeId: 4 }, { employeeId: 3 }, { employeeId: 99 }] }, empleados);
        expect(r.enfermeria.map((x) => [x.empleado.id, x.indice])).toEqual([[3, 1]]);
    });
});

describe('punto de la pestaña Expediente', () => {
    const hoy = new Date('2026-10-29T18:00:00Z');
    const completo = {
        srsPermitUrl: 'u', srsExpiration: '2027-12-01', municipalUrl: 'u', municipalExpiration: '2027-12-01',
        regentCredentialUrl: 'u', regentCredentialExp: '2027-12-01', regentInscriptionUrl: 'u',
        farmacovigilanciaAuthUrl: 'u', pharmacovigilanceExp: '2027-12-01', fumigationUrl: 'u',
    };
    it('todo al día → sin punto', () => {
        expect(alertaDelExpediente({ settings: { legal: completo } }, hoy)).toBeNull();
    });
    it('falta un documento crítico → crítico', () => {
        expect(alertaDelExpediente({ settings: { legal: { ...completo, srsPermitUrl: null } } }, hoy)).toBe('critical');
    });
    it('falta uno no crítico → aviso', () => {
        expect(alertaDelExpediente({ settings: { legal: { ...completo, fumigationUrl: null } } }, hoy)).toBe('warning');
    });
    it('vencido (cualquiera) → crítico; por vencer → aviso', () => {
        expect(alertaDelExpediente({ settings: { legal: { ...completo, municipalExpiration: '2026-10-01' } } }, hoy)).toBe('critical');
        expect(alertaDelExpediente({ settings: { legal: { ...completo, municipalExpiration: '2026-11-15' } } }, hoy)).toBe('warning');
    });
});

describe('el expediente mira lo mismo que el aviso diario', () => {
    it('la anualidad de enfermería vence', async () => {
        const { documentosDeSucursal, estadoDeDocumento, vencimientoEfectivo } = await import('@nucleo/utils/expedienteDeSucursal');
        const b = { settings: { legal: { injections: true, nursingRegents: [{ id: 1, employeeId: 'a', anualidadUrl: 'u', anualidadExp: '2026-01-31' }] } } };
        const doc = documentosDeSucursal(b).personal.find(d => d.id === 'nurse_anualidad_0');
        expect(estadoDeDocumento(doc.url, vencimientoEfectivo(doc), new Date('2026-10-29T18:00:00Z')).type).toBe('EXPIRED');
    });
    it('la recarga de extintores vencida enciende el punto', async () => {
        const { alertaDelExpediente } = await import('@nucleo/utils/expedienteDeSucursal');
        const legal = { srsPermitUrl: 'u', regentCredentialUrl: 'u', farmacovigilanciaAuthUrl: 'u', municipalUrl: 'u', regentInscriptionUrl: 'u', fumigationUrl: 'u' };
        const hoy = new Date('2026-10-29T18:00:00Z');
        expect(alertaDelExpediente({ settings: { legal } }, hoy)).toBe(null);
        expect(alertaDelExpediente({ settings: { legal: { ...legal, extinguisherExpiration: '2026-10-01' } } }, hoy)).toBe('critical');
    });
});

describe('cada sucursal ve lo suyo: el expediente se une aparte', () => {
    it('une el expediente a settings sin perder el horario ni la ubicación', async () => {
        const { unirExpediente } = await import('@nucleo/utils/edicionDeSucursal');
        const b = unirExpediente({ id: 1, settings: { location: { lat: 1 }, propertyType: 'RENTED' } }, { legal: { srsPermit: 'X' }, rent: { amount: 300 } });
        expect(b.settings).toEqual({ location: { lat: 1 }, propertyType: 'RENTED', legal: { srsPermit: 'X' }, rent: { amount: 300 } });
        expect(b.rent).toEqual({ amount: 300 });
        expect(b.expedienteOculto).toBe(false);
    });
    it('una sala ajena queda marcada y sus alertas no inventan faltas', async () => {
        const { unirExpediente } = await import('@nucleo/utils/edicionDeSucursal');
        const { alertasDeSucursal, completitudDelPerfil } = await import('@nucleo/utils/sucursales');
        const ajena = unirExpediente({ id: 2, type: 'FARMACIA', address: 'x', phone: '1', settings: { propertyType: 'RENTED' } }, undefined);
        expect(ajena.expedienteOculto).toBe(true);
        const mensajes = alertasDeSucursal(ajena, Date.now(), []).list.map((a) => a.message);
        expect(mensajes).not.toContain('Falta regente');
        expect(mensajes).not.toContain('Falta contrato');
        expect(mensajes).not.toContain('Falta permiso SRS');
        expect(completitudDelPerfil(ajena)).toEqual({ legal: null, property: null, services: null });
    });
});
