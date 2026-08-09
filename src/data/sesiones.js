import { supabase } from '../supabaseClient';

// SesionesView.jsx (F4 de docs/PLAN-SESIONES-SEGURAS-2026-08-08.md).
//
// `auth.sessions` vive en el esquema `auth` y no está expuesta a PostgREST, así
// que todo pasa por las dos RPC. `list_sessions` devuelve **json y no SETOF** a
// propósito: PostgREST trunca cualquier respuesta SETOF a 1000 filas en
// silencio, y con las cuentas de prueba incluidas hay más de 3,500 conexiones.

export async function fetchSesiones(incluirPruebas = false) {
    const { data, error } = await supabase.rpc('list_sessions', { p_incluir_pruebas: incluirPruebas });
    if (error) return { data: [], error };
    return { data: Array.isArray(data) ? data : [], error: null };
}

export function cerrarSesion(sessionId) {
    return supabase.rpc('revoke_session', { p_session_id: sessionId });
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
