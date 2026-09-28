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
    NO_EXISTE: (u) => `No existe el usuario «${u}». Revisa cómo lo escribiste: es nombre.apellido.`,
    CONTRASENA: () => 'Contraseña incorrecta. Si no la recuerdas, pide a tu supervisor que la restablezca.',
    INACTIVO: () => 'Tu cuenta está desactivada. Contacta a Recursos Humanos.',
    BLOQUEADO: () => 'Tu acceso está bloqueado. Contacta a Recursos Humanos.',
    SIN_ACCESO: () => 'Tu usuario todavía no tiene acceso al portal. Pide a tu supervisor que te lo active.',
    CUENTA_DESALINEADA: () => 'Tu usuario tiene un problema de configuración. Pide a Sistemas que lo revise.',
    DEMASIADOS_INTENTOS: () => 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.',
};

export async function motivoDeLoginFallido(usuario) {
    try {
        const { data, error } = await supabase.functions.invoke('ensure_user_by_code', {
            body: { diagnosticar_usuario: usuario },
        });
        const armar = !error && data?.ok ? MENSAJE_DE_ESTADO[data.estado] : null;
        return armar ? armar(usuario) : GENERICO;
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
 * Cambia la contraseña de quien tiene la sesión y apaga la marca de «debe
 * cambiarla» (primer ingreso). Devuelve `{ error }` como `auth.updateUser`.
 */
export const cambiarMiContrasenaInicial = (password) =>
    supabase.auth.updateUser({ password, data: { must_change_password: false } });
