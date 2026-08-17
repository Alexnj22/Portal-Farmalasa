import { supabase } from '../supabaseClient';
import { signPhotosDeep } from '../utils/storageFiles';

// SesionesView.jsx (F4 de docs/PLAN-SESIONES-SEGURAS-2026-08-08.md).
//
// `auth.sessions` vive en el esquema `auth` y no está expuesta a PostgREST, así
// que todo pasa por RPC. `list_sessions` devuelve **json y no SETOF** a
// propósito: PostgREST trunca cualquier respuesta SETOF a 1000 filas en
// silencio, y un listado que miente por truncamiento es peor que no tenerlo.

export async function fetchSesiones() {
    const { data, error } = await supabase.rpc('list_sessions');
    if (error) return { data: [], error };
    // Las fotos del personal viven en un bucket PRIVADO: lo que devuelve la RPC
    // es el identificador crudo y hay que firmarlo o no se ve nada.
    const filas = Array.isArray(data) ? data : [];
    return { data: await signPhotosDeep(filas), error: null };
}

export function cerrarSesion(sessionId) {
    return supabase.rpc('revoke_session', { p_session_id: sessionId });
}

export function cerrarTodasDe(personaId) {
    return supabase.rpc('revoke_person_sessions', { p_user_id: personaId });
}

// ── Agrupar por persona ─────────────────────────────────────────────────────
// La vista es una tarjeta por PERSONA, no una fila por conexión: con 214
// conexiones repartidas entre 9 personas, la lista plana no dejaba ver lo único
// que importa de un vistazo —quién está conectado y desde cuándo—.
export function agruparPorPersona(filas) {
    const porPersona = new Map();
    for (const f of filas) {
        const clave = f.persona_id || f.cuenta;
        if (!porPersona.has(clave)) {
            porPersona.set(clave, {
                persona_id: f.persona_id,
                empleado: f.empleado,
                cuenta: f.cuenta,
                cargo: f.cargo,
                foto: f.foto,
                bloqueado_hasta: f.bloqueado_hasta,
                bloqueo_motivo: f.bloqueo_motivo,
                conexiones: [],
                ultima_conexion: null,
            });
        }
        const p = porPersona.get(clave);
        // `session_id` nulo = persona SIN conexiones vivas. Llega igual, por dos
        // motivos: una bloqueada necesita dónde desbloquearse, y del resto hay
        // que poder ver cuándo entró por última vez. No es una conexión y no
        // entra en la lista —pero su fecha sí se guarda aparte, que es lo único
        // que esa fila viene a contar.
        if (f.session_id) p.conexiones.push(f);
        else if (f.ultimo_movimiento
                 && (!p.ultima_conexion || new Date(f.ultimo_movimiento) > new Date(p.ultima_conexion))) {
            p.ultima_conexion = f.ultimo_movimiento;
        }
    }
    for (const p of porPersona.values()) {
        p.conexiones.sort((a, b) => new Date(b.ultimo_movimiento) - new Date(a.ultimo_movimiento));
        // Sin conexiones vivas manda la última conexión conocida. Antes esto
        // quedaba en `null` y la tarjeta mostraba un guión: la persona aparecía
        // sin ninguna pista de cuándo había entrado.
        p.ultimo_movimiento = p.conexiones[0]?.ultimo_movimiento || p.ultima_conexion || null;
        p.bloqueado = estaBloqueado(p.bloqueado_hasta);
        p.tiene_esta = p.conexiones.some(c => c.es_actual);
    }
    return [...porPersona.values()]
        .sort((a, b) => new Date(b.ultimo_movimiento) - new Date(a.ultimo_movimiento));
}

// ── Qué dispositivo es, en palabras ─────────────────────────────────────────
// Lo que llega es la cadena que declaró el navegador. Sirve para que alguien
// reconozca «esto no fui yo»; NO es prueba de nada, y por eso la pantalla la
// muestra resumida y sin prometer certeza.
export function describirDispositivo(agente) {
    const s = String(agente || '');
    if (!s) return 'Desconocido';

    const sistema =
        /iPhone/i.test(s)                       ? 'iPhone'
      : /iPad/i.test(s)                         ? 'iPad'
      : /Android/i.test(s)                      ? 'Android'
      : /Windows/i.test(s)                      ? 'Windows'
      : /Mac OS X|Macintosh/i.test(s)           ? 'Mac'
      : /Linux/i.test(s)                        ? 'Linux'
      : null;

    // El orden importa: casi todos mienten diciendo también «Safari» o
    // «Chrome», así que los más específicos van primero.
    const navegador =
        /Edg\//i.test(s)                        ? 'Edge'
      : /OPR\/|Opera/i.test(s)                  ? 'Opera'
      : /Firefox|FxiOS/i.test(s)                ? 'Firefox'
      : /CriOS|Chrome/i.test(s)                 ? 'Chrome'
      : /Safari/i.test(s)                       ? 'Safari'
      : null;

    return [sistema, navegador].filter(Boolean).join(' · ') || 'Desconocido';
}

// ── Hace cuánto, en palabras ────────────────────────────────────────────────
export function haceCuanto(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const seg = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (seg < 60)      return 'hace instantes';
    const min = Math.round(seg / 60);
    if (min < 60)      return `hace ${min} min`;
    const hrs = Math.round(min / 60);
    if (hrs < 24)      return `hace ${hrs} h`;
    const dias = Math.round(hrs / 24);
    return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}

export function diasDesde(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return Infinity;
    return (Date.now() - t) / 86_400_000;
}

// El límite de inactividad que le toca a esa conexión, dicho en palabras del
// negocio — nunca en minutos crudos, que no le dicen nada a nadie.
export function describirLimite(minutos) {
    if (minutos == null) return null;
    if (minutos >= 1440) {
        const d = Math.round(minutos / 1440);
        return d === 1 ? '1 día sin usarse' : `${d} días sin usarse`;
    }
    if (minutos >= 60) {
        const h = Math.round(minutos / 60);
        return h === 1 ? '1 hora sin usarse' : `${h} horas sin usarse`;
    }
    return `${minutos} min sin usarse`;
}

// ── Bloqueo ─────────────────────────────────────────────────────────────────
// Bloquear corta de verdad: además de cerrar las sesiones, una policy
// RESTRICTIVE en las 135 tablas deja a la persona sin leer ni escribir nada, y
// el hook le niega tokens nuevos. Es la diferencia con cerrar una conexión, que
// sólo impide renovar.

export function bloquearPersona(personaId, hasta, motivo) {
    return supabase.rpc('block_employee', {
        p_employee_id: personaId,
        p_until: hasta ?? null,      // null = indefinido
        p_reason: motivo || null,
    });
}

export function desbloquearPersona(personaId) {
    return supabase.rpc('unblock_employee', { p_employee_id: personaId });
}

// `blocked_until` viene con 'infinity' cuando el bloqueo no tiene fecha. Ese
// valor no se puede pasar por `new Date()` — hay que reconocerlo antes.
export function describirBloqueo(hasta) {
    if (!hasta) return null;
    if (String(hasta).startsWith('infinity')) return 'Bloqueado indefinidamente';
    const t = Date.parse(hasta);
    if (!Number.isFinite(t)) return 'Bloqueado';
    if (t <= Date.now()) return null;   // ya venció: se liberó solo
    return `Bloqueado hasta el ${new Date(t).toLocaleDateString('es-SV')}`;
}

export function estaBloqueado(hasta) {
    if (!hasta) return false;
    if (String(hasta).startsWith('infinity')) return true;
    const t = Date.parse(hasta);
    return Number.isFinite(t) && t > Date.now();
}
