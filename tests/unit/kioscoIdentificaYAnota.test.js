// El kiosco: cómo identifica un carné, cómo registra un marcaje, y qué NO
// escribe en la bitácora.
//
// La regla que ordena la primera mitad:
//
//   > **El valor escaneado NO se compara en el navegador.** Hasta esa versión el
//   > arranque repartía el código de cada empleado de la sala, y ese código es
//   > la contraseña del portal de esa persona.
//
// Y la segunda mitad es lo contrario de lo que un log suele hacer: acá lo
// importante es lo que se **borra** antes de guardar. Un DUI, un PIN tecleado o
// un token dentro de una entrada de auditoría son una credencial guardada en
// texto plano, en la tabla que menos se mira y más se conserva.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { kioscoIdentificar, kioscoMarcar, kioscoBitacora } = await import('../../src/data/kiosco');
const { redactSensitive, normalizeKioskAuditInfo, INPUT_METHOD, DETAILS_MAX_BYTES } =
    await import('../../src/utils/timeClock.audit');
const { ICONO_POR_TIPO, iconoDeTipo } = await import('../../src/constants/tipoIconos');

const rpcReal = espia.supabase.rpc;
const conEquipo = () => localStorage.setItem('kiosk_config',
    JSON.stringify({ deviceId: 'd1', deviceToken: 'tok' }));

beforeEach(() => { espia.limpiar(); localStorage.clear(); espia.supabase.rpc = rpcReal; });

describe('identificar un carné', () => {
    it('el valor escaneado viaja al servidor con las credenciales del EQUIPO', async () => {
        conEquipo();
        espia.supabase.rpc = rpcReal;
        await kioscoIdentificar('ABC123');
        expect(espia.rpc[0].nombre).toBe('kiosco_identificar');
        expect(Object.values(espia.rpc[0].args)).toEqual(expect.arrayContaining(['d1', 'tok']));
    });

    it('sin equipo vinculado NO pregunta, y lo dice con un motivo propio', async () => {
        // «Esta tablet no está vinculada» y «este carné no existe» son cosas
        // distintas y se contestan distinto.
        const r = await kioscoIdentificar('ABC123');
        expect(r).toEqual({ ok: false, motivo: 'SIN_EQUIPO', networkError: false });
        expect(espia.rpc).toHaveLength(0);
    });

    it('unas credenciales a medias cuentan como sin equipo', async () => {
        localStorage.setItem('kiosk_config', JSON.stringify({ deviceId: 'd1' }));
        expect((await kioscoIdentificar('X')).motivo).toBe('SIN_EQUIPO');
    });

    it('un `localStorage` corrupto no revienta el kiosco', async () => {
        localStorage.setItem('kiosk_config', 'no es json');
        expect((await kioscoIdentificar('X')).motivo).toBe('SIN_EQUIPO');
    });
});

describe('registrar el marcaje', () => {
    it('la hora la pone el SERVIDOR', async () => {
        // Es lo que impide que el reloj de una tablet desajustada mueva una
        // jornada entera.
        conEquipo();
        await kioscoMarcar({ employeeId: 'e1', tipo: 'PUNCH_IN' });
        expect(espia.rpc[0].nombre).toBe('kiosco_marcar');
        const args = Object.values(espia.rpc[0].args);
        expect(args).toContain(null);       // el momento viaja nulo
    });

    it('salvo que sea uno RECUPERADO de la cola: ahí viaja su hora real', async () => {
        // Un marcaje encolado a las 8 y recuperado a las 15 entraría a planilla
        // como si la persona hubiera llegado a las 15.
        conEquipo();
        await kioscoMarcar({ employeeId: 'e1', tipo: 'PUNCH_IN', momento: '2026-08-24T14:00:00Z' });
        expect(Object.values(espia.rpc[0].args)).toContain('2026-08-24T14:00:00Z');
    });

    it('sin equipo no marca', async () => {
        expect((await kioscoMarcar({ employeeId: 'e1', tipo: 'PUNCH_IN' })).ok).toBe(false);
        expect(espia.rpc).toHaveLength(0);
    });

    it('la bitácora del kiosco también pasa por el servidor', async () => {
        conEquipo();
        await kioscoBitacora('CARNE_NO_RECONOCIDO', null, { intento: 1 });
        expect(espia.rpc[0].nombre).toBe('kiosco_bitacora');
    });
});

describe('lo que NUNCA entra a una entrada de auditoría', () => {
    it('el DUI se borra, escrito de las dos formas', () => {
        const d = redactSensitive({ employee_dui: '00000000-0', dui: '00000000-0', ok: true });
        expect(d).toEqual({ ok: true });
    });

    it('las credenciales tecleadas también', () => {
        const d = redactSensitive({
            password: 'x', pin_ingresado: '1234', token: 't',
            access_token: 'a', refresh_token: 'r', authorization: 'Bearer x',
            auth: {}, headers: {}, motivo: 'se equivocó de botón',
        });
        expect(d).toEqual({ motivo: 'se equivocó de botón' });
    });

    it('NO modifica el objeto original: quien lo llamó lo sigue necesitando', () => {
        // El flujo que anota sigue trabajando con los datos completos.
        const original = { dui: '000', ok: true };
        redactSensitive(original);
        expect(original.dui).toBe('000');
    });

    it('lo que no es sensible pasa entero, incluidos los anidados', () => {
        const d = redactSensitive({ a: 1, b: { c: 2 }, lista: [1, 2] });
        expect(d).toEqual({ a: 1, b: { c: 2 }, lista: [1, 2] });
    });

    it('un objeto imposible de serializar no rompe la anotación', () => {
        // Un ciclo acá tiraría el `JSON.stringify` y con él la entrada entera:
        // se pierde la anotación por un dato de adorno.
        const ciclo = { ok: true };
        ciclo.yo = ciclo;
        expect(redactSensitive(ciclo)).toEqual({});
    });

    it('sin detalles devuelve un objeto vacío, no `undefined`', () => {
        expect(redactSensitive()).toEqual({});
        expect(redactSensitive(null)).toEqual({});
    });

    it('hay un techo de tamaño declarado', () => {
        // Una entrada sin techo es una tabla que crece sin control por un
        // volcado accidental.
        expect(DETAILS_MAX_BYTES).toBe(20_000);
    });
});

describe('normalizar de dónde vino un marcaje', () => {
    it('acepta las dos grafías de cada campo', () => {
        // Conviven `branch_id` y `branchId` porque los datos llegan de la base y
        // del navegador, y ninguno es motivo para reescribir el otro.
        expect(normalizeKioskAuditInfo({ branchId: 4, employeeName: 'Ana' }))
            .toMatchObject({ branch_id: '4', employee_name: 'Ana' });
        expect(normalizeKioskAuditInfo({ branch_id: 4, employee_name: 'Ana' }))
            .toMatchObject({ branch_id: '4', employee_name: 'Ana' });
    });

    it('sin nombre de equipo dice «Kiosco Autorizado», no queda vacío', () => {
        // Una entrada sin equipo no se puede rastrear a una tablet.
        expect(normalizeKioskAuditInfo({}).device_name).toBe('Kiosco Autorizado');
    });

    it('el método de entrada se guarda en MAYÚSCULA, y sin dato es «desconocido»', () => {
        expect(normalizeKioskAuditInfo({ input_method: 'carne' }).input_method).toBe('CARNE');
        expect(normalizeKioskAuditInfo({}).input_method).toBe(INPUT_METHOD.UNKNOWN);
    });

    it('una cadena de espacios es tan vacía como no venir', () => {
        expect(normalizeKioskAuditInfo({ employee_name: '   ' }).employee_name).toBeNull();
    });

    it('con basura devuelve la forma completa igual', () => {
        // Quien la consume lee sus nueve campos: un `undefined` en el medio
        // rompería la fila.
        const r = normalizeKioskAuditInfo('no es un objeto');
        expect(Object.keys(r)).toHaveLength(9);
    });
});

describe('un tipo, un ícono, en toda la app', () => {
    it('los seis tipos que la campana pintaba iguales tienen el suyo', () => {
        // `NotificationBell` resolvía por prefijo y todo lo demás caía al ícono
        // genérico, mientras cinco de ellos ya tenían ícono propio a dos vistas
        // de distancia.
        for (const t of ['ANNULMENT_REQUEST', 'CLIENT_CHANGE_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                         'VENDOR_CHANGE_REQUEST', 'SHIFT_CHANGE', 'SYSTEM'])
            expect(ICONO_POR_TIPO[t], t).toBeTruthy();
    });

    it('un tipo desconocido devuelve un ícono igual: nada queda sin dibujar', () => {
        expect(iconoDeTipo('ALGO_QUE_NO_EXISTE')).toBeTruthy();
        expect(iconoDeTipo('')).toBeTruthy();
        expect(iconoDeTipo()).toBeTruthy();
    });

    it('un tipo conocido devuelve EL suyo, no el genérico', () => {
        expect(iconoDeTipo('SYSTEM')).toBe(ICONO_POR_TIPO.SYSTEM);
        expect(iconoDeTipo('ANNULMENT_REQUEST')).toBe(ICONO_POR_TIPO.ANNULMENT_REQUEST);
    });

    it('ningún tipo declara un ícono nulo', () => {
        for (const [t, icono] of Object.entries(ICONO_POR_TIPO)) expect(icono, t).toBeTruthy();
    });
});
