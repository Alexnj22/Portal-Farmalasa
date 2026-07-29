// Capa de datos de autorización del kiosco.
//
// Reemplaza la comparación client-side de useTimeClockEngine.js, donde el
// código de autorización se calculaba en el navegador con `Math.sin()` del
// reloj (helpers.js:180) y se comparaba contra lo tecleado. Cualquiera que
// abriera el bundle público —que es público por definición— calculaba el
// código de la hora y se autorizaba sus propias horas extra.
//
// Ahora el código sale de un HMAC con un pepper que vive en Vault, y la
// verificación ocurre en el servidor (verify_kiosk_authorization), que además
// aplica rate limit por dispositivo y acepta como alternativa el PIN personal
// de un supervisor de la sucursal comparado contra bcrypt.
//
// Igual que `validateKioskToken` (branchSlice.js), estas funciones distinguen
// "el servidor dijo que no" de "no se pudo preguntar": el kiosco necesita esa
// diferencia para no bloquear un marcaje solo porque se cayó el internet.

import { supabase } from '../supabaseClient';

// Verifica el código de autorización de una excepción de marcaje (los 6 casos
// `requiresAuth` de timeClock.helpers.js). Acepta el código horario del
// servidor o el PIN personal de un supervisor.
//
// → { ok, method, authorizerName, networkError }
export async function verifyKioskAuthorization({ deviceId, deviceToken, employeeId, code }) {
    const { data, error } = await supabase.rpc('verify_kiosk_authorization', {
        p_device_id: deviceId,
        p_device_token: deviceToken,
        p_employee_id: employeeId,
        p_code: code,
    });

    if (error) {
        // El rate limit y el dispositivo inválido son negativos REALES del
        // servidor, no fallos de red: no deben caer al camino offline.
        const msg = String(error.message || '');
        const serverRejection = msg.includes('KIOSK_PIN_RATE_LIMITED') || msg.includes('KIOSK_DEVICE_INVALID');
        return {
            ok: false,
            method: null,
            authorizerName: null,
            networkError: !serverRejection,
            rateLimited: msg.includes('KIOSK_PIN_RATE_LIMITED'),
        };
    }

    return {
        ok: Boolean(data?.ok),
        method: data?.method || null,
        authorizerName: data?.authorizer_name || null,
        networkError: false,
        rateLimited: false,
    };
}

// Verifica el PIN personal de UN empleado ya identificado por carné.
// Una sola comparación bcrypt (~80 ms).
export async function verifyKioskPin({ deviceId, deviceToken, employeeId, pin }) {
    const { data, error } = await supabase.rpc('verify_kiosk_pin', {
        p_device_id: deviceId,
        p_device_token: deviceToken,
        p_employee_id: employeeId,
        p_pin: pin,
    });

    if (error) {
        const msg = String(error.message || '');
        const serverRejection = msg.includes('KIOSK_PIN_RATE_LIMITED') || msg.includes('KIOSK_DEVICE_INVALID');
        return { ok: false, networkError: !serverRejection, rateLimited: msg.includes('KIOSK_PIN_RATE_LIMITED') };
    }
    return { ok: Boolean(data?.ok), networkError: false, rateLimited: false };
}

// El jefe lee el código vigente desde el portal (reemplaza getHourlyCode()).
// Gated server-side por el permiso kiosk_pin/can_view.
export async function fetchKioskAuthCode(branchId = null) {
    return supabase.rpc('get_kiosk_auth_code', { p_branch_id: branchId });
}

// Guarda el PIN de un empleado. El PIN se genera aleatorio en el cliente, se
// muestra UNA vez, y acá solo viaja para que el servidor guarde su hash — no
// se persiste en claro en ningún lado.
export async function setKioskPin(employeeId, pin) {
    return supabase.rpc('set_kiosk_pin', { p_employee_id: employeeId, p_pin: pin });
}
