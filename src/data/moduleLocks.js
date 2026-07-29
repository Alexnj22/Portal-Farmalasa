// Candado de mantenimiento por módulo (F0 — PLAN-MINMAX-Y-CANDADO-2026-07-29).
//
// El candado REAL vive en la BD: auth_can_edit_any() consulta auth_module_locked()
// y con eso quedan cubiertas 59 policies sobre 30 tablas + 23 RPCs, incluido quien
// llame a PostgREST directo. Lo de acá es la mitad de UX: apagar los botones y
// explicar por qué, en vez de dejar que el usuario escriba y se coma un rechazo.
//
// No es decorativo NI redundante — es necesario por un detalle de cómo funciona
// RLS: un UPDATE cuya policy USING no pasa afecta 0 filas SIN lanzar error
// (verificado en staging, y es el comportamiento que ya existe hoy sin candado).
// supabase-js devuelve `error: null`, así que un guardado optimista mostraría un
// valor que nunca se persistió. Gatear en el cliente evita ese silencio.
import { supabase } from '../supabaseClient';

export function fetchModuleLocks() {
    return supabase
        .from('module_locks')
        .select('module_key, locked_by_id, locked_by_name, reason, locked_at, expires_at')
        .gt('expires_at', new Date().toISOString());
}

export function lockModule(moduleKey, reason, hours = 4) {
    return supabase.rpc('lock_module', {
        p_module_key: moduleKey,
        p_reason: reason || null,
        p_hours: hours,
    });
}

export function unlockModule(moduleKey) {
    return supabase.rpc('unlock_module', { p_module_key: moduleKey });
}

// Mensajes de las excepciones del servidor. Sin esto el usuario ve
// 'ALREADY_LOCKED: minmax ya está bloqueado...' con el prefijo técnico.
export function translateLockError(msg) {
    if (!msg) return 'No se pudo completar la operación.';
    if (/ALREADY_LOCKED/.test(msg))    return 'Ese módulo ya está bloqueado por otra persona.';
    if (/PERMISSION_DENIED/.test(msg)) return 'No tenés permiso para bloquear o liberar este módulo.';
    if (/UNKNOWN_MODULE/.test(msg))    return 'Ese módulo no existe.';
    if (/NO_EMPLOYEE/.test(msg))       return 'No se pudo identificar tu empleado. Cerrá sesión y volvé a entrar.';
    return msg;
}
