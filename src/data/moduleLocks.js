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

// Los módulos donde el candado SÍ hace algo. La RPC los deriva de las policies y
// de los cuerpos de las funciones (los arrays de auth_can_edit_any), no de una
// lista escrita a mano: hoy son 27 de 93, y bloquear uno de los otros 66 no
// frenaría nada. Un diccionario acá se desactualizaría con la primera policy
// nueva, en silencio — que es exactamente el tipo de bug que tenía el módulo.
export function fetchLockableModules() {
    return supabase.rpc('get_lockable_modules');
}

// `translateLockError` vivía acá y se eliminó el 2026-08-01. Traducía las
// cuatro excepciones del servidor (ALREADY_LOCKED, PERMISSION_DENIED,
// UNKNOWN_MODULE, NO_EMPLOYEE) y terminaba en `return msg`: los cuatro casos
// esperados salían bien y cualquier otro salía crudo. Las cuatro reglas están
// ahora en `utils/errorMessages`, que no tiene esa salida de escape.
