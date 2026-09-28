// Bloque 6.A — capa de datos, entidad "audit". Extraído de
// auditSlice.js: 2 llamadas supabase.from() (appendAuditLog/fetchAuditLogs).
// Lo escrito sobre esta área:
// `docs/SISTEMA-LA-BITACORA-LOS-RESPALDOS-Y-LA-SALUD-2026-08-24.md` — por qué la
// autoría sale de la sesión y no de `localStorage`, qué se respalda y qué se
// resincroniza, y las dos lecciones de la caja negra.
import { supabase } from '../supabaseClient';
import { armarEntrada } from '../utils/bitacora';

// La autoría del log NO la elige el navegador: la resuelve
// `registrar_bitacora` con `auth_employee_id()` adentro. Es el mismo patrón de
// `registrar_egreso`, y llegó acá tarde — la bitácora estuvo muda 22 días.
//
// Lo que había era un `.insert()` con `user_id: auth.uid()` y un `.select()`
// encadenado, y **cada una de esas dos cosas por separado** bastaba para perder
// la fila, en silencio:
//
//  1 · `audit_logs.user_id` es la FICHA — lo dice su FK `fk_audit_logs_user` y
//      lo exige la policy desde el 2026-08-10, cuando pasó de `auth.uid()` a
//      `auth_employee_id()`. Este archivo siguió mandando la CUENTA. Los dos
//      valores coinciden sólo si la persona entra por su puerta vieja, y 46 de
//      las 48 fichas activas tienen además una cuenta enlazada con otro id.
//  2 · El `.select()` es un RETURNING, y un RETURNING tiene que pasar
//      `audit_logs_select`, que pide `auditview.can_view`. Lo tienen 4 de 48
//      personas — y son EXACTAMENTE las 4 que firmaron algo desde el 10-ago.
//      O sea que escribir la bitácora exigía poder leerla.
//
// Medido: de 42+ personas usando el portal, sólo esas 4 dejaron rastro, y ni
// `PEDIDO_LLEGADA_CONFIRMADA` ni ningún `PEDIDO_*` se escribió después del
// 17-ago. Por eso, al revisar el pedido 10-310826-3, no había con qué
// reconstruir qué se había tocado en la pantalla de llegada.
//
// La función devuelve la fila escrita, así que el llamador tampoco tiene que
// inventar la firma para su lista local.
export function insertAuditLog(logData) {
    return supabase.rpc('registrar_bitacora', {
        p_action:       logData.action,
        p_target_id:    logData.target_id,
        p_details:      logData.details,
        p_source:       logData.source,
        p_severity:     logData.severity,
        p_branch_id:    logData.branch_id,
        p_branch_name:  logData.branch_name,
        p_device_name:  logData.device_name,
        p_input_method: logData.input_method,
        // De respaldo: sólo se usa si la ficha no se puede resolver.
        p_user_name:    logData.user_name,
    });
}

// ── Anotar desde la capa de datos (2026-09-28) ─────────────────────────────
// Las funciones que GUARDAN anotan su propia entrada, para que cualquier
// cliente —el portal o la app del teléfono— la herede al llamarlas. La pantalla
// ya no tiene que acordarse. `appendAuditLog` del store también pasa por acá.
//
// Nunca lanza: una acción ya hecha no puede fallar porque no se pudo anotar
// (y en dinero y lo fiscal la base anota además por su cuenta,
// `bitacora_de_dinero`). Devuelve la fila escrita, o `null`.
const escuchas = new Set();

/** Avisa cada fila anotada (el store la agrega a su lista local). */
export function escucharAnotaciones(fn) {
    escuchas.add(fn);
    return () => escuchas.delete(fn);
}

export async function anotar(accion, targetId = null, detalles = {}, { nombre = null } = {}) {
    const entrada = armarEntrada(accion, targetId, detalles, nombre);
    if (!entrada) return null;
    try {
        const { data, error } = await insertAuditLog(entrada);
        if (error) throw error;
        const fila = data || { ...entrada, created_at: new Date().toISOString() };
        for (const fn of escuchas) {
            try { fn(fila); } catch { /* una escucha rota no corta a las demás */ }
        }
        return fila;
    } catch (err) {
        console.error('bitácora: no se pudo anotar', entrada.action, err?.message || err);
        return null;
    }
}

/**
 * Espera la escritura y, si salió bien, anota. No demora la respuesta: la
 * anotación sale por detrás (nunca lanza). Devuelve `{ data, error }` tal cual.
 */
export async function conBitacora(escritura, accion, targetId, detalles = {}) {
    const res = await escritura;
    if (!res?.error) anotar(accion, targetId, detalles);
    return res;
}

export function fetchAuditLogs(limit) {
    return supabase.from('audit_logs')
        .select('id,user_id,user_name,action,target_id,details,source,severity,branch_id,branch_name,device_name,input_method,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
}
