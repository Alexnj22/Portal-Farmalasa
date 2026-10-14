// Bloque 6.A — capa de datos, entidad "auth". Extraído de
// AuthContext.jsx (loginWithUsername): 1 llamada supabase.from(),
// crítica para el flujo de login — se preserva exacta (mismo .single(),
// mismo `select('*')`).
import { supabase } from '../supabaseClient';
import { anotar } from './audit';

/**
 * Por qué falló un login con usuario y contraseña, en palabras para la persona.
 * Se llama SÓLO después de un `invalid_credentials`: Auth contesta lo mismo para
 * un usuario que no existe y para una contraseña equivocada, y el servidor lo
 * distingue con un tope de intentos por IP (ver `diagnosticarUsuario` en
 * `ensure_user_by_code`). Nunca lanza: si no puede averiguarlo, devuelve el
 * mensaje genérico — un diagnóstico caído no puede dejar a nadie sin respuesta.
 */
const GENERICO = 'Usuario o contraseña incorrectos.';
const MENSAJE_DE_ESTADO = {
    NO_EXISTE: 'Usuario incorrecto.',
    CONTRASENA: 'Contraseña incorrecta.',
    INACTIVO: 'Usuario dado de baja.',
    BLOQUEADO: 'Usuario bloqueado.',
    SIN_ACCESO: 'Usuario sin acceso al portal.',
    CUENTA_DESALINEADA: 'Usuario mal configurado. Avisa a Sistemas.',
    DEMASIADOS_INTENTOS: 'Demasiados intentos. Espera unos minutos.',
};

export async function motivoDeLoginFallido(usuario) {
    try {
        const { data, error } = await supabase.functions.invoke('ensure_user_by_code', {
            body: { diagnosticar_usuario: usuario },
        });
        return (!error && data?.ok && MENSAJE_DE_ESTADO[data.estado]) || GENERICO;
    } catch {
        return GENERICO;
    }
}

export function fetchEmployeeSafeByUsername(username) {
    return supabase.from('employees_safe').select('*').eq('username', username).single();
}

/**
 * Fija la contraseña de un empleado por su usuario (función del servidor que
 * exige permiso). Devuelve `{ data, error }` como `functions.invoke`.
 *
 * Es el ÚNICO camino para cambiar una contraseña (el autoservicio se quitó en
 * v2.1030.0), así que anota `CONTRASENA_RESTABLECIDA` cuando entra: quién la
 * restableció y a quién — nunca la contraseña. La anota esta función y no la
 * pantalla (D3, 2026-09-28): los dos formularios que la llaman la anotaban
 * cada uno por su lado, y la app la hereda sin tener que acordarse.
 */
export async function fijarContrasenaDeEmpleado(username, password, { employeeId = null } = {}) {
    const res = await supabase.functions.invoke('set-employee-password', { body: { username, password } });
    if (!res?.error && res?.data?.ok) {
        anotar('CONTRASENA_RESTABLECIDA', employeeId != null ? String(employeeId) : null, { usuario: username });
    }
    return res;
}

/** El usuario de la sesión actual (el de Supabase Auth), o null. */
export async function usuarioDeLaSesion() {
    const { data: { user } } = await supabase.auth.getUser();
    return user ?? null;
}

/**
 * Cambia la contraseña de quien tiene la sesión (primer ingreso) y RENUEVA el
 * token antes de devolver.
 *
 * Lo que decide «debe cambiarla» es `app_metadata.cambio_de_clave`, que viaja
 * DENTRO del JWT. Al escribir la contraseña el servidor quita la marca, pero el
 * token que ya tiene el navegador la sigue diciendo hasta que se renueve — y la
 * base bloquea los datos mientras el token diga `primer_acceso`. Sin el
 * `refreshSession()` la persona entraría a un portal que no le devuelve nada.
 *
 * Devuelve `{ error, reentrar, session }`:
 *   · `error` sin `reentrar` → la contraseña NO cambió (regla, red…).
 *   · `reentrar: true` → la contraseña SÍ cambió, pero no se pudo renovar la
 *     sesión: quien llama la cierra y pide entrar con la clave nueva.
 *
 * `must_change_password: false` se sigue escribiendo en `user_metadata`
 * porque `set-employee-password` lo lee para decidir si conserva la clave de
 * la persona. NO decide nada del lado del navegador.
 */
export async function cambiarMiContrasenaInicial(password) {
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (error) return { error, reentrar: false, session: null };
    try {
        const { data, error: errRenovar } = await supabase.auth.refreshSession();
        if (errRenovar || !data?.session) {
            return { error: errRenovar || new Error('SIN_SESION'), reentrar: true, session: null };
        }
        return { error: null, reentrar: false, session: data.session };
    } catch (e) {
        return { error: e, reentrar: true, session: null };
    }
}
