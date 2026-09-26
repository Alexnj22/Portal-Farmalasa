// Bloque 6.A — capa de datos, entidad "auth". Extraído de
// AuthContext.jsx (loginWithUsername): 1 llamada supabase.from(),
// crítica para el flujo de login — se preserva exacta (mismo .single(),
// mismo `select('*')`).
import { supabase } from '../supabaseClient';

export function fetchEmployeeSafeByUsername(username) {
    return supabase.from('employees_safe').select('*').eq('username', username).single();
}

/**
 * Fija la contraseña de un empleado por su usuario (función del servidor que
 * exige permiso). Devuelve `{ data, error }` como `functions.invoke`.
 */
export const fijarContrasenaDeEmpleado = (username, password) =>
    supabase.functions.invoke('set-employee-password', { body: { username, password } });

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
