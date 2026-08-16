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

// Un error de PostgREST que trae `code` es una respuesta REAL del servidor;
// sin `code` es una caída de red. La diferencia decide si el marcaje se
// descarta o se encola.
const esRechazoDelServidor = (error) => Boolean(error?.code);

function credenciales() {
    try {
        const raw = localStorage.getItem('kiosk_config');
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
