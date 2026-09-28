// Bloque 6.A — capa de datos, entidad "auth". Extraído de
// AuthContext.jsx (loginWithUsername): 1 llamada supabase.from(),
// crítica para el flujo de login — se preserva exacta (mismo .single(),
// mismo `select('*')`).
import { supabase } from '../supabaseClient';
import { anotar } from './audit';

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
 * Cambia la contraseña de quien tiene la sesión y apaga la marca de «debe
 * cambiarla» (primer ingreso). Devuelve `{ error }` como `auth.updateUser`.
 */
export const cambiarMiContrasenaInicial = (password) =>
    supabase.auth.updateUser({ password, data: { must_change_password: false } });
