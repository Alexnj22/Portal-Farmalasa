// Las sesiones abiertas y el carné de papel.
//
// Las dos cosas son de seguridad, y las dos tienen una regla que se rompe sola
// si nadie la mira:
//
//   · **la condición de «vivo» de un carné está escrita DOS veces** —acá y en
//     `resolver_carne_temporal`—. Si se separan, la pantalla mostraría como
//     anulable algo que ya no lo es, o —peor— escondería un papel que **sigue
//     abriendo el portal**;
//   · el carné de PLÁSTICO lleva impreso el `kiosk_pin`, que **es la contraseña
//     del portal de esa persona**. Imprimirlo en un ticket dejaría esa
//     credencial permanente sobre un mostrador; por eso el de papel usa otro
//     secreto, aleatorio, hasheado y con vencimiento.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
const invoke = vi.fn(async () => ({ data: { ok: true, secreto: 'S3CR3T0' }, error: null }));
espia.supabase.functions = { invoke: (...a) => invoke(...a) };
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { emitirCarneTemporal, fetchCarnesVigentes, fetchCarnesTemporales,
        anularCarneTemporal, carneVigente } = await import('../../src/data/carneTemporal');
const { agruparPorPersona, describirDispositivo, haceCuanto, diasDesde, describirLimite,
        cerrarSesion, cerrarTodasDe, bloquearPersona } = await import('../../src/data/sesiones');
const { verifyKioskAuthorization, verifyKioskPin } = await import('../../src/data/kioskAuth');
const { fetchEmployeeSafeByUsername } = await import('../../src/data/auth');

const rpcReal = espia.supabase.rpc;
beforeEach(() => {
    espia.limpiar(); vi.clearAllMocks(); espia.supabase.rpc = rpcReal;
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-24T14:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('¿este carné de papel sigue sirviendo?', () => {
    const vivo = { anulado_el: null, vence_el: '2026-08-25T05:59:00Z' };

    it('vivo: sin anular y sin vencer', () => {
        expect(carneVigente(vivo)).toBe(true);
    });

    it('anulado no sirve, aunque no haya vencido', () => {
        expect(carneVigente({ ...vivo, anulado_el: '2026-08-24T13:00:00Z' })).toBe(false);
    });

    it('vencido no sirve, aunque no esté anulado', () => {
        expect(carneVigente({ ...vivo, vence_el: '2026-08-24T13:59:00Z' })).toBe(false);
    });

    it('sin fila no sirve — y devuelve `false`, no `undefined`', () => {
        // Un `undefined` en un `if` de seguridad se lee como «no», pero en un
        // `=== false` se lee como «sí».
        expect(carneVigente(null)).toBe(false);
        expect(carneVigente(undefined)).toBe(false);
    });

    it('la LISTA usa la misma condición que la función', () => {
        // Si se separan, la pantalla escondería un papel que sigue abriendo el
        // portal.
        fetchCarnesVigentes();
        expect(espia.primero('is')).toEqual(['anulado_el', null]);
        const [columna, instante] = espia.primero('gt');
        expect(columna).toBe('vence_el');
        expect(instante).toBe('2026-08-24T14:00:00.000Z');
    });

    it('el tope de la lista es un número deliberado, NO el cap de PostgREST', () => {
        // 1000 trunca en silencio; 50 es un freno que se ve.
        fetchCarnesVigentes();
        expect(espia.primero('limit')).toEqual([50]);
    });

    it('el historial de una persona sale del más reciente', () => {
        fetchCarnesTemporales('emp-1');
        expect(espia.primero('eq')).toEqual(['employee_id', 'emp-1']);
        expect(espia.primero('order')).toEqual(['created_at', { ascending: false }]);
    });
});

describe('emitir el carné de papel', () => {
    it('pasa por una función con la sesión de quien apretó el botón', async () => {
        // El papel también abre sesión, y para eso hace falta una cuenta de Auth
        // con ese secreto por contraseña — sólo la llave de servicio puede
        // crearla. El PERMISO igual lo decide la base.
        await emitirCarneTemporal('emp-1', 'olvidó el carné', 4);
        expect(invoke).toHaveBeenCalledWith('emitir-carne-temporal', {
            body: { employee_id: 'emp-1', motivo: 'olvidó el carné', impreso_en: 4 },
        });
    });

    it('la sala por cuya ticketera sale se guarda CON el carné', async () => {
        // Escribirla en un segundo paso dejaría, ante un fallo entre los dos, un
        // carné del que nadie sabe por dónde salió — que es justo el dato que se
        // pide para auditarlo.
        await emitirCarneTemporal('emp-1');
        expect(invoke.mock.calls[0][1].body).toHaveProperty('impreso_en', null);
    });

    it('sin permiso lo dice con esas palabras', async () => {
        invoke.mockResolvedValueOnce({ data: { ok: false, error: 'SIN_PERMISO' }, error: null });
        expect(await emitirCarneTemporal('emp-1'))
            .toEqual({ ok: false, motivo: 'No tienes permiso para emitir carnés.' });
    });

    it('un fallo de red no se confunde con un rechazo', async () => {
        invoke.mockResolvedValueOnce({ data: null, error: { message: '503' } });
        expect((await emitirCarneTemporal('emp-1')).motivo).toContain('conexión');
    });

    it('si falla NO hay papel, y eso es la falla correcta', async () => {
        // El secreto viaja UNA sola vez y no se guarda en ninguna parte: lo que
        // sigue es imprimirlo.
        invoke.mockResolvedValueOnce({ data: { ok: false }, error: null });
        expect((await emitirCarneTemporal('emp-1')).ok).toBe(false);
    });

    it('anular va por función, y un fallo no se lee como éxito', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: null, error: { message: 'x' } });
        expect((await anularCarneTemporal(3)).ok).toBe(false);
    });
});

describe('las sesiones abiertas, agrupadas por persona', () => {
    const fila = (o) => ({ persona_id: 'p1', empleado: 'Ana', cuenta: 'ana', ...o });

    it('junta las conexiones de una misma persona', () => {
        const r = agruparPorPersona([
            fila({ session_id: 's1', ultimo_movimiento: '2026-08-24T13:00:00Z' }),
            fila({ session_id: 's2', ultimo_movimiento: '2026-08-24T13:30:00Z' }),
        ]);
        expect(r).toHaveLength(1);
        expect(r[0].conexiones).toHaveLength(2);
    });

    it('la conexión más reciente va primero', () => {
        const r = agruparPorPersona([
            fila({ session_id: 's1', ultimo_movimiento: '2026-08-24T13:00:00Z' }),
            fila({ session_id: 's2', ultimo_movimiento: '2026-08-24T13:30:00Z' }),
        ]);
        expect(r[0].conexiones[0].session_id).toBe('s2');
    });

    it('una persona SIN conexiones vivas igual aparece, con su última entrada', () => {
        // Llega por dos motivos: una bloqueada necesita dónde desbloquearse, y
        // del resto hay que poder ver cuándo entró por última vez. Antes esto
        // quedaba en `null` y la tarjeta mostraba un guión.
        const r = agruparPorPersona([
            fila({ session_id: null, ultimo_movimiento: '2026-08-20T10:00:00Z' }),
        ]);
        expect(r[0].conexiones).toHaveLength(0);
        expect(r[0].ultimo_movimiento).toBe('2026-08-20T10:00:00Z');
    });

    it('sabe si una de las conexiones es la de quien está mirando', () => {
        // Es lo que evita que alguien se cierre su propia sesión sin querer.
        const r = agruparPorPersona([
            fila({ session_id: 's1', ultimo_movimiento: '2026-08-24T13:00:00Z', es_actual: true }),
        ]);
        expect(r[0].tiene_esta).toBe(true);
    });

    it('marca a quien está bloqueado', () => {
        const r = agruparPorPersona([
            fila({ session_id: null, bloqueado_hasta: '2026-09-01T00:00:00Z' }),
        ]);
        expect(r[0].bloqueado).toBe(true);
    });

    it('las personas salen ordenadas por su última actividad', () => {
        const r = agruparPorPersona([
            fila({ persona_id: 'p1', session_id: 's1', ultimo_movimiento: '2026-08-20T10:00:00Z' }),
            fila({ persona_id: 'p2', session_id: 's2', ultimo_movimiento: '2026-08-24T13:00:00Z' }),
        ]);
        expect(r.map(p => p.persona_id)).toEqual(['p2', 'p1']);
    });

    it('sin filas devuelve una lista vacía', () => {
        expect(agruparPorPersona([])).toEqual([]);
    });
});

describe('qué dispositivo es, en palabras', () => {
    it('reconoce sistema y navegador', () => {
        expect(describirDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604'))
            .toBe('iPhone · Safari');
        expect(describirDispositivo('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'))
            .toBe('Windows · Chrome');
    });

    it('los que MIENTEN diciendo también «Safari» o «Chrome» se resuelven bien', () => {
        // Casi todos lo hacen, así que los más específicos van primero.
        expect(describirDispositivo('Windows NT 10.0 Chrome/120 Safari/537 Edg/120'))
            .toBe('Windows · Edge');
        expect(describirDispositivo('Macintosh Chrome/120 Safari/537 OPR/106'))
            .toBe('Mac · Opera');
        expect(describirDispositivo('iPhone; CPU iPhone OS 17_0 FxiOS/120 Safari/604'))
            .toBe('iPhone · Firefox');
    });

    it('lo que no reconoce dice «Desconocido», no una cadena vacía', () => {
        // Es información para que alguien diga «esto no fui yo»: un hueco no
        // ayuda a decidir.
        expect(describirDispositivo('')).toBe('Desconocido');
        expect(describirDispositivo(null)).toBe('Desconocido');
        expect(describirDispositivo('curl/8.4.0')).toBe('Desconocido');
    });
});

describe('hace cuánto, y hasta cuándo', () => {
    it('lo dice en palabras, no en un instante', () => {
        expect(haceCuanto('2026-08-24T13:59:30Z')).toBe('hace instantes');
        expect(haceCuanto('2026-08-24T13:30:00Z')).toBe('hace 30 min');
        expect(haceCuanto('2026-08-24T09:00:00Z')).toBe('hace 5 h');
        expect(haceCuanto('2026-08-23T14:00:00Z')).toBe('hace 1 día');
        expect(haceCuanto('2026-08-20T14:00:00Z')).toBe('hace 4 días');
    });

    it('una fecha futura no dice «hace −5 min»', () => {
        expect(haceCuanto('2026-08-24T14:30:00Z')).toBe('hace instantes');
    });

    it('sin fecha, o rota, devuelve null en vez de «NaN»', () => {
        expect(haceCuanto(null)).toBeNull();
        expect(haceCuanto('ayer')).toBeNull();
    });

    it('sin fecha, la antigüedad es INFINITA — nunca 0', () => {
        // Un 0 se leería como «entró recién», que es lo contrario.
        expect(diasDesde(null)).toBe(Infinity);
        expect(diasDesde('basura')).toBe(Infinity);
        expect(diasDesde('2026-08-22T14:00:00Z')).toBe(2);
    });

    it('el límite de inactividad se dice en palabras del negocio', () => {
        // Nunca en minutos crudos, que no le dicen nada a nadie.
        expect(describirLimite(5)).toBe('5 min sin usarse');
        expect(describirLimite(60)).toBe('1 hora sin usarse');
        expect(describirLimite(120)).toBe('2 horas sin usarse');
        expect(describirLimite(1440)).toBe('1 día sin usarse');
        expect(describirLimite(2880)).toBe('2 días sin usarse');
        expect(describirLimite(null)).toBeNull();
    });
});

describe('cerrar y bloquear son cosas distintas', () => {
    it('cerrar una conexión y cerrar todas son funciones distintas', () => {
        cerrarSesion('s1');
        expect(espia.rpc[0]).toEqual({ nombre: 'revoke_session', args: { p_session_id: 's1' } });
        espia.limpiar();
        cerrarTodasDe('p1');
        expect(espia.rpc[0]).toEqual({ nombre: 'revoke_person_sessions', args: { p_user_id: 'p1' } });
    });

    it('bloquear lleva hasta cuándo y por qué', () => {
        // Bloquear corta de verdad: una policy RESTRICTIVE en las 135 tablas la
        // deja sin leer ni escribir nada. Cerrar una conexión sólo impide
        // renovar.
        bloquearPersona('p1', '2026-09-01T00:00:00Z', 'se fue de la empresa');
        expect(espia.rpc[0].nombre).toBe('block_employee');
        expect(Object.values(espia.rpc[0].args)).toContain('se fue de la empresa');
    });
});

describe('autorizar en el kiosco: «dijo que no» NO es «no pude preguntar»', () => {
    // El código de autorización se calculaba EN EL NAVEGADOR con `Math.sin()`
    // del reloj y se comparaba contra lo tecleado: cualquiera que abriera el
    // bundle —que es público por definición— calculaba el código de la hora y se
    // autorizaba sus propias horas extra. Hoy sale de un HMAC con un pepper en
    // Vault y se verifica en el servidor.
    //
    // Y el kiosco necesita distinguir los dos noes: uno cae al camino offline y
    // el otro no.
    const conError = (message) => { espia.supabase.rpc = () => Promise.resolve({ data: null, error: { message } }); };
    const conDatos = (data) => { espia.supabase.rpc = () => Promise.resolve({ data, error: null }); };

    it('un ok del servidor dice con qué método se autorizó', async () => {
        conDatos({ ok: true, method: 'CODE', authorizer_name: 'Ana' });
        expect(await verifyKioskAuthorization({ deviceId: 'd', deviceToken: 't', employeeId: 'e', code: '123456' }))
            .toEqual({ ok: true, method: 'CODE', authorizerName: 'Ana', networkError: false, rateLimited: false });
    });

    it('un NO del servidor no es un fallo de red', async () => {
        conDatos({ ok: false });
        const r = await verifyKioskAuthorization({ deviceId: 'd', deviceToken: 't', employeeId: 'e', code: 'x' });
        expect(r.ok).toBe(false);
        expect(r.networkError).toBe(false);
    });

    it('el rate limit es un negativo REAL: no cae al camino offline', async () => {
        // Si cayera, bastaría con teclear mal muchas veces para que el kiosco
        // pasara a confiar en su ventana de gracia.
        conError('KIOSK_PIN_RATE_LIMITED');
        const r = await verifyKioskAuthorization({ deviceId: 'd', deviceToken: 't', employeeId: 'e', code: 'x' });
        expect(r).toMatchObject({ ok: false, networkError: false, rateLimited: true });
    });

    it('un dispositivo inválido también', async () => {
        conError('KIOSK_DEVICE_INVALID');
        const r = await verifyKioskAuthorization({ deviceId: 'd', deviceToken: 't', employeeId: 'e', code: 'x' });
        expect(r).toMatchObject({ ok: false, networkError: false, rateLimited: false });
    });

    it('cualquier otro error SÍ es de red: no se bloquea un marcaje por internet', async () => {
        conError('Failed to fetch');
        expect((await verifyKioskAuthorization({ deviceId: 'd', deviceToken: 't', employeeId: 'e', code: 'x' })).networkError)
            .toBe(true);
    });

    it('el código y el token del dispositivo viajan al servidor, no se comparan acá', async () => {
        conDatos({ ok: true });
        await verifyKioskAuthorization({ deviceId: 'd1', deviceToken: 'tok', employeeId: 'e1', code: '999999' });
        // Se re-arma el espía para poder inspeccionar los argumentos.
        espia.supabase.rpc = rpcReal;
        espia.limpiar();
        await verifyKioskPin({ deviceId: 'd1', deviceToken: 'tok', employeeId: 'e1', pin: '1234' });
        expect(espia.rpc[0].nombre).toBe('verify_kiosk_pin');
        expect(Object.values(espia.rpc[0].args)).toEqual(expect.arrayContaining(['d1', 'tok', 'e1', '1234']));
    });
});

describe('el login por usuario', () => {
    it('lee la VISTA segura, no la tabla', () => {
        // `employees` tiene columnas que no son de todos; `employees_safe` es la
        // puerta.
        fetchEmployeeSafeByUsername('ana');
        expect(espia.tabla()).toBe('employees_safe');
        expect(espia.primero('eq')).toEqual(['username', 'ana']);
    });
});
