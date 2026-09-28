// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
    autenticar, transmitir, transmitirConReintentos, consultar, tokenVigente, ErrorHacienda, HOSTS,
} from '../../supabase/functions/_shared/dte/hacienda.ts';
import { armarInvalidacion, armarContingencia } from '../../supabase/functions/_shared/dte/eventos.ts';
import esqInvalidacion from '../../supabase/functions/_shared/dte/esquemas/invalidacion-schema-v3.json';
import esqContingencia from '../../supabase/functions/_shared/dte/esquemas/contingencia-schema-v4.json';

// El cliente de la API de Hacienda, con un `fetch` falso que responde como la
// guía de integración v8.0 documenta (respuestas copiadas de sus ejemplos).
// Lo que importa acá no es el camino feliz sino la política de reintentos: un
// documento reenviado a ciegas cuando Hacienda sí lo había recibido es un
// duplicado, y uno que se da por perdido cuando entró es un DTE sellado que el
// portal cree pendiente.

const ajv = new Ajv({ allErrors: true });
const validar = (esq, json) => { const v = ajv.compile(esq); return v(json) ? [] : v.errors.map(e => `${e.dataPath} ${e.message}`); };

const falso = (guion) => {
    const llamadas = [];
    const f = async (url, init) => {
        llamadas.push({ url, body: init.body, headers: init.headers });
        const paso = guion.shift();
        if (!paso) throw new Error('llamada de más');
        if (paso === 'red') throw new TypeError('fetch failed');
        return new Response(JSON.stringify(paso.cuerpo), { status: paso.http });
    };
    return { f, llamadas };
};
const TOKEN = { token: 'Bearer abc', obtenido: new Date() };
const DOC = { tipoDte: '03', version: 4, codigoGeneracion: 'A1B2C3D4-E5F6-4789-8ABC-DEF012345678', firmado: 'h.p.s', nitEmisor: '04070101261015' };
const SELLO = '20269E9D4DC0292F4681AD759B0B0F5CA99DC23G';
const procesado = { http: 200, cuerpo: { version: 2, ambiente: '00', estado: 'PROCESADO', codigoGeneracion: DOC.codigoGeneracion, selloRecibido: SELLO, fhProcesamiento: '26/09/2026 10:31:02', codigoMsg: '001', descripcionMsg: 'RECIBIDO', observaciones: [] } };
const rechazado = { http: 400, cuerpo: { estado: 'RECHAZADO', codigoGeneracion: DOC.codigoGeneracion, codigoMsg: '004', descripcionMsg: '[identificacion.codigoGeneracion] YA EXISTE UN REGISTRO CON ESE VALOR', observaciones: null } };
const sinEspera = async () => {};

describe('autenticación', () => {
    it('manda user/pwd como formulario y guarda el token con su «Bearer»', async () => {
        const { f, llamadas } = falso([{ http: 200, cuerpo: { status: 'OK', body: { user: '04070101261015', token: 'Bearer eyJ.x.y' } } }]);
        const t = await autenticar('00', '04070101261015', 'clave', f);
        expect(t.token).toBe('Bearer eyJ.x.y');
        expect(llamadas[0].url).toBe(`${HOSTS['00']}/seguridad/auth`);
        expect(llamadas[0].body).toBe('user=04070101261015&pwd=clave');
    });
    it('credenciales malas: lanza con el mensaje de Hacienda', async () => {
        const { f } = falso([{ http: 200, cuerpo: { status: 'ERROR', error: 'Unauthorized', message: 'Usuario no valido' } }]);
        await expect(autenticar('00', 'x', 'y', f)).rejects.toThrow(/Usuario no valido/);
    });
    it('el token se reutiliza hasta 23 horas', () => {
        const ahora = new Date('2026-09-26T12:00:00Z');
        expect(tokenVigente({ token: 'x', obtenido: new Date('2026-09-25T14:00:00Z') }, ahora)).toBe(true);
        expect(tokenVigente({ token: 'x', obtenido: new Date('2026-09-25T12:30:00Z') }, ahora)).toBe(false);
        expect(tokenVigente(null, ahora)).toBe(false);
    });
});

describe('transmisión', () => {
    it('PROCESADO: devuelve el sello', async () => {
        const { f, llamadas } = falso([procesado]);
        const r = await transmitir('00', TOKEN, DOC, f);
        expect(r.selloRecibido).toBe(SELLO);
        const cuerpo = JSON.parse(llamadas[0].body);
        expect(cuerpo).toEqual({ ambiente: '00', idEnvio: 1, version: 4, tipoDte: '03', documento: 'h.p.s', codigoGeneracion: DOC.codigoGeneracion });
        expect(llamadas[0].headers.Authorization).toBe('Bearer abc');
    });
    it('RECHAZADO (HTTP 400) es una respuesta, no una excepción', async () => {
        const { f } = falso([rechazado]);
        const r = await transmitir('00', TOKEN, DOC, f);
        expect(r.estado).toBe('RECHAZADO');
        expect(r.observaciones).toEqual([]);
    });
});

describe('reintentos: consultar ANTES de reenviar', () => {
    it('sin respuesta, y Hacienda sí lo tenía: no se reenvía', async () => {
        const { f, llamadas } = falso(['red', { http: 200, cuerpo: { numValidacion: SELLO, codigoGeneracion: DOC.codigoGeneracion } }]);
        const r = await transmitirConReintentos('00', TOKEN, DOC, f, sinEspera);
        expect(r.selloRecibido).toBe(SELLO);
        expect(llamadas.map(l => l.url.replace(HOSTS['00'], ''))).toEqual(['/fesv/recepciondte', '/fesv/recepcion/consultadte/']);
    });
    it('sin respuesta, y Hacienda no lo tenía: se reenvía', async () => {
        const { f, llamadas } = falso(['red', { http: 404, cuerpo: null }, procesado]);
        const r = await transmitirConReintentos('00', TOKEN, DOC, f, sinEspera);
        expect(r.selloRecibido).toBe(SELLO);
        expect(llamadas.length).toBe(3);
    });
    it('tres veces sin respuesta: lanza «sin respuesta» (→ contingencia)', async () => {
        const { f } = falso(['red', 'red', 'red', 'red', 'red']);
        const e = await transmitirConReintentos('00', TOKEN, DOC, f, sinEspera).catch(x => x);
        expect(e).toBeInstanceOf(ErrorHacienda);
        expect(e.sinRespuesta).toBe(true);
    });
    it('un rechazo NO se reintenta', async () => {
        const { f, llamadas } = falso([rechazado]);
        const r = await transmitirConReintentos('00', TOKEN, DOC, f, sinEspera);
        expect(r.estado).toBe('RECHAZADO');
        expect(llamadas.length).toBe(1);
    });
    it('un 401 (token vencido) no se reintenta a ciegas', async () => {
        const { f } = falso([{ http: 401, cuerpo: {} }]);
        await expect(transmitirConReintentos('00', TOKEN, DOC, f, sinEspera)).rejects.toThrow(/401/);
    });
    it('consultar: 404 = no lo tiene', async () => {
        const { f } = falso([{ http: 404, cuerpo: null }]);
        expect(await consultar('00', TOKEN, DOC, f)).toBeNull();
    });
});

const EMISOR = { nit: '0407-010126-101-5', nombre: 'DISTRIBUIDORA DE PRUEBA, S.A.S.', telefono: '23010013', correo: 'facturas@ejemplo.com', codEstableMH: 'B001', codPuntoVentaMH: 'P001' };
const PERSONA = { nombre: 'ENCARGADA DE PRUEBA', tipoDocumento: '13', numDocumento: '01234567-8' };

describe('eventos contra su esquema oficial', () => {
    const doc = { tipoDte: '03', codigoGeneracion: DOC.codigoGeneracion, selloRecibido: SELLO, numeroControl: 'DTE-03-B001P001-000000000000007', fecEmi: '2026-09-20',
        receptor: { tipoDocumento: '36', numDocumento: '0407-150390-102-3', nombre: 'FARMACIA DEL PUEBLO', telefono: '24445555', correo: null } };

    it('invalidación por rescindir la operación', () => {
        const j = armarInvalidacion({ ambiente: '00', emisor: EMISOR, documento: doc, tipo: 2, motivo: null, responsable: PERSONA, solicita: PERSONA });
        expect(validar(esqInvalidacion, j)).toEqual([]);
        expect(j.documento.numDocumento).toBe('04071503901023');
    });
    it('invalidación por error exige el documento que lo reemplaza', () => {
        expect(() => armarInvalidacion({ ambiente: '00', emisor: EMISOR, documento: doc, tipo: 1, motivo: null, responsable: PERSONA, solicita: PERSONA }))
            .toThrow(/reemplaza/);
    });
    it('no se invalida algo sin sello', () => {
        expect(() => armarInvalidacion({ ambiente: '00', emisor: EMISOR, documento: { ...doc, selloRecibido: '' }, tipo: 2, motivo: null, responsable: PERSONA, solicita: PERSONA }))
            .toThrow(/sello/);
    });
    it('contingencia por falta de internet, con horas de El Salvador', () => {
        const j = armarContingencia({
            ambiente: '00', emisor: { ...EMISOR, tipoEstablecimiento: '04' }, responsable: PERSONA,
            documentos: [{ tipoDte: '01', codigoGeneracion: DOC.codigoGeneracion }],
            desde: new Date('2026-09-26T15:00:00Z'), hasta: new Date('2026-09-26T19:30:00Z'), tipo: 3,
            ahora: new Date('2026-09-26T20:00:00Z'),
        });
        expect(validar(esqContingencia, j)).toEqual([]);
        expect(j.motivo).toMatchObject({ fInicio: '2026-09-26', hInicio: '09:00:00', hFin: '13:30:00' });
        expect(j.detalleDTE).toEqual([{ noItem: 1, tipoDoc: '01', codigoGeneracion: DOC.codigoGeneracion }]);
    });
});
