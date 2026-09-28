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
import { conBitacora } from './audit';

export function fetchModuleLocks() {
    return supabase
        .from('module_locks')
        .select('module_key, locked_by_id, locked_by_name, reason, locked_at, expires_at')
        .gt('expires_at', new Date().toISOString());
}

// Poner o levantar un candado se anota solo (D3, 2026-09-28): lo escribe la
// función que lo hace y no la pantalla, así que también quedan anotados los que
// se levantan desde el aviso del módulo o desde la app. Sólo si entró.

/** Poner (o ajustar el motivo/la duración de) un candado → `MODULE_LOCK_ON`. */
export function lockModule(moduleKey, reason, hours = 4, contexto = {}) {
    return conBitacora(supabase.rpc('lock_module', {
        p_module_key: moduleKey,
        p_reason: reason || null,
        p_hours: hours,
    }), 'MODULE_LOCK_ON', moduleKey, { module: moduleKey, reason: reason || null, hours, ...contexto });
}

/** Levantar un candado → `MODULE_LOCK_OFF`. */
export function unlockModule(moduleKey) {
    return conBitacora(supabase.rpc('unlock_module', { p_module_key: moduleKey }),
        'MODULE_LOCK_OFF', moduleKey, { module: moduleKey });
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
