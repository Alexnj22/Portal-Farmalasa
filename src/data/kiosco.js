// Capa de datos del kiosco de marcación.
//
// El kiosco corre SIN sesión: la pantalla `/kiosk` es la única del portal que
// se atiende con la llave pública. Por eso ninguna de sus escrituras puede ir
// directo a una tabla — todas las policies del proyecto exigen `authenticated`,
// y sin sesión `auth_employee_id()` ni siquiera se puede ejecutar (comprobado:
// `HTTP 401 permission denied for function auth_employee_id`).
//
// Lo que valida al kiosco es su dispositivo: el par `deviceId`/`deviceToken`
// que ya usaban `verify_kiosk_device` y el arranque. Cada función de acá lo
// presenta, y el servidor acota todo a la sucursal de ESE equipo.
//
// Igual que `validateKioskToken`, estas funciones distinguen «el servidor dijo
// que no» de «no se pudo preguntar»: el kiosco necesita esa diferencia para no
// tirar un marcaje sólo porque se cayó el internet.

import { supabase } from '../supabaseClient';
import * as almacen from '@plataforma/almacen';
import { esFalloTransitorio } from '../utils/errorTransitorio';

// La diferencia entre «el servidor dijo que no» y «no se pudo preguntar»
// decide si el marcaje se descarta o se encola. Hasta el 2026-10-21 era
// `Boolean(error?.code)`, pero los fallos transitorios TAMBIÉN traen código
// (`PGRST003` del pool saturado, `57014` del timeout): en una saturación el
// marcaje se perdía. Ver `errorTransitorio.js`.
const esRechazoDelServidor = (error) => !esFalloTransitorio(error);

function credenciales() {
    try {
        const raw = almacen.leer('kiosk_config');
        if (!raw) return null;
        const cfg = JSON.parse(raw);
        if (!cfg?.deviceId || !cfg?.deviceToken) return null;
        return { deviceId: String(cfg.deviceId), deviceToken: String(cfg.deviceToken) };
    } catch {
        return null;
    }
}

// ¿De quién es este carné? El valor escaneado NO se compara en el navegador:
// hasta esta versión el arranque repartía el código de cada empleado de la
// sala, y ese código es la contraseña del portal de esa persona.
//
// → { ok, employeeId, motivo, networkError, rateLimited }
export async function kioscoIdentificar(carne) {
    const cred = credenciales();
    if (!cred) return { ok: false, motivo: 'SIN_EQUIPO', networkError: false };

    const { data, error } = await supabase.rpc('kiosco_identificar', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
        p_carne: carne,
    });

    if (error) {
        const msg = String(error.message || '');
        return {
            ok: false,
            motivo: msg.includes('KIOSK_PIN_RATE_LIMITED') ? 'DEMASIADOS_INTENTOS' : 'ERROR',
            rateLimited: msg.includes('KIOSK_PIN_RATE_LIMITED'),
            networkError: !esRechazoDelServidor(error),
        };
    }

    return {
        ok: Boolean(data?.ok),
        employeeId: data?.employee_id || null,
        metodo: data?.metodo || null,
        motivo: data?.motivo || null,
        // Viene sólo cuando se reconoció a la persona y aun así se le niega el
        // paso (`SIN_ACCESO`): el kiosco necesita su nombre para decir qué pasa
        // de verdad en vez de «carné no reconocido», que la mandaría a pedir un
        // carné nuevo por un problema que no es del carné.
        nombre: data?.nombre || null,
        networkError: false,
        rateLimited: false,
    };
}

// Registra el marcaje. La hora la pone el SERVIDOR salvo que sea un marcaje
// recuperado de la cola, en cuyo caso viaja la hora real en que ocurrió.
//
// → { ok, marcaje, motivo, networkError }
export async function kioscoMarcar({ employeeId, tipo, detalles = null, momento = null }) {
    const cred = credenciales();
    if (!cred) return { ok: false, motivo: 'SIN_EQUIPO', networkError: false };

    const { data, error } = await supabase.rpc('kiosco_marcar', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
        p_employee_id: employeeId,
        p_tipo: tipo,
        p_detalles: detalles || {},
        p_momento: momento || null,
    });

    if (error) {
        return {
            ok: false,
            motivo: String(error.message || 'ERROR'),
            networkError: !esRechazoDelServidor(error),
        };
    }

    return {
        ok: Boolean(data?.ok),
        marcaje: data?.marcaje || null,
        motivo: data?.motivo || null,
        previo: data?.previo || null,
        evento: data?.evento || null,
        networkError: false,
    };
}

// Los marcajes de ayer y hoy de la gente de esta sucursal. Sin esto el kiosco
// no sabe si alguien ya entró — y resolvía SIEMPRE «entrada», porque su lista
// llegaba vacía sin que nada fallara a la vista.
export async function kioscoMarcajesRecientes() {
    const cred = credenciales();
    if (!cred) return { ok: false, marcajes: [] };

    const { data, error } = await supabase.rpc('kiosco_marcajes_recientes', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
    });

    if (error) return { ok: false, marcajes: [], networkError: !esRechazoDelServidor(error) };
    return { ok: true, marcajes: Array.isArray(data) ? data : [] };
}

// Bitácora de seguridad del kiosco. La lista de acciones la valida el servidor.
// Es best-effort a propósito: que no se pueda anotar un intento no debe impedir
// el marcaje de quien sí tiene derecho a marcar.
export async function kioscoBitacora(accion, employeeId = null, detalles = {}) {
    const cred = credenciales();
    if (!cred) return { ok: false };

    const { error } = await supabase.rpc('kiosco_bitacora', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
        p_accion: accion,
        p_employee_id: employeeId,
        p_detalles: detalles || {},
    });

    if (error) console.error('kiosco: no se pudo anotar en la bitácora:', error.message);
    return { ok: !error };
}

export async function kioscoAvisoLeido(announcementId, employeeId) {
    const cred = credenciales();
    if (!cred) return { ok: false };

    const { error } = await supabase.rpc('kiosco_aviso_leido', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
        p_announcement_id: announcementId,
        p_employee_id: employeeId,
    });

    return { ok: !error };
}

export async function kioscoDeclararTurno({ employeeId, inicio, fin, metadata = {} }) {
    const cred = credenciales();
    if (!cred) return { ok: false };

    const { error } = await supabase.rpc('kiosco_declarar_turno', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
        p_employee_id: employeeId,
        p_inicio: inicio,
        p_fin: fin,
        p_metadata: metadata || {},
    });

    if (error) console.error('kiosco: no se pudo declarar el turno:', error.message);
    return { ok: !error };
}

// La cola de preventas que esperan cobro en la sucursal del equipo. Sólo la ve
// un kiosco de CAJA: a un marcador el servidor le contesta `KIOSK_NO_ES_CAJA`.
// Fase 1 del plan del kiosco de caja: sólo lectura.
//
// → { ok, cola, motivo, networkError }
export async function kioscoCajaCola() {
    const cred = credenciales();
    if (!cred) return { ok: false, cola: [], motivo: 'SIN_EQUIPO', networkError: false };

    const { data, error } = await supabase.rpc('kiosco_caja_cola', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
    });

    if (error) {
        const msg = String(error.message || '');
        return {
            ok: false,
            cola: [],
            motivo: msg.includes('KIOSK_NO_ES_CAJA') ? 'NO_ES_CAJA' : msg.includes('KIOSK_DEVICE_INVALID') ? 'SIN_EQUIPO' : 'ERROR',
            networkError: !esRechazoDelServidor(error),
        };
    }
    return { ok: true, cola: Array.isArray(data) ? data : [], motivo: null, networkError: false };
}

// Si la caja de la sucursal del equipo está abierta, el turno corriendo y si el
// día ya se cerró. Sin montos. Para que el inicio del kiosco sugiera qué toca.
//
// → { ok, estado: { abierta, turno, turno_corriendo, dia, cerrado, cortes }, networkError }
export async function kioscoCajaEstado() {
    const cred = credenciales();
    if (!cred) return { ok: false, estado: null, networkError: false };
    const { data, error } = await supabase.rpc('kiosco_caja_estado', {
        p_device_id: cred.deviceId,
        p_device_token: cred.deviceToken,
    });
    if (error) return { ok: false, estado: null, networkError: !esRechazoDelServidor(error) };
    return { ok: true, estado: data ?? null, networkError: false };
}

// Vincula ESTE equipo con un ticket impreso, sin sesión. Si el equipo ya era
// un kiosco, manda su credencial para que la base lo reemplace (revoca el
// viejo en la misma transacción).
//
// → { ok, equipo, motivo: 'USADO'|'VENCIDO'|'INVALIDO'|'LLENO'|'ERROR', networkError }
export async function kioscoVincularConTicket(codigo) {
    const cred = credenciales();
    const { data, error } = await supabase.rpc('kiosco_vincular_con_ticket', {
        p_codigo: String(codigo ?? '').replace(/\s+/g, '').toUpperCase(),
        p_device_id: cred?.deviceId ?? null,
        p_device_token: cred?.deviceToken ?? null,
    });
    if (error) {
        const msg = String(error.message || '');
        const motivo = msg.includes('TICKET_USADO') ? 'USADO'
            : msg.includes('TICKET_VENCIDO') ? 'VENCIDO'
            : msg.includes('TICKET_INVALIDO') ? 'INVALIDO'
            : msg.includes('Límite alcanzado') ? 'LLENO' : 'ERROR';
        return { ok: false, equipo: null, motivo, detalle: motivo === 'LLENO' ? msg : null, networkError: !esRechazoDelServidor(error) };
    }
    return { ok: true, equipo: data, motivo: null, networkError: false };
}
