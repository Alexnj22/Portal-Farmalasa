/**
 * ¿Qué pantalla toca mientras la sesión termina de armarse?
 *
 * Existe porque el 2026-08-16 el usuario reportó haber visto **«Sin acceso —
 * tu cuenta no tiene módulos habilitados»** unos segundos al cerrar sesión,
 * antes de que la app lo mandara al login. No era cierto: sus permisos estaban
 * bien, lo que había fallado era LEERLOS.
 *
 * La causa es que `rolePerms` valía `null` para dos cosas distintas —«todavía
 * no se sabe» y «se leyó y no hay ninguno»— y la app resolvía las dos igual:
 * ningún módulo con permiso ⇒ redirigir a `/no-access`, con un `<Navigate
 * replace>` que además dejaba ahí aunque los permisos llegaran después.
 *
 * Hoy `null` es DESCONOCIDO y `{}` es «vacío de verdad». Y un fallo de lectura
 * tiene su propia pantalla, que dice lo que pasó y ofrece reintentar, en vez de
 * acusar a la cuenta de algo que no ocurrió.
 */
export const PANTALLA = {
    SPLASH: 'splash',
    ERROR_PERMISOS: 'error-permisos',
    APP: 'app',
};

/**
 * @param {object} p
 * @param {boolean} p.cargando          la sesión todavía se está resolviendo
 * @param {boolean} p.autenticado       hay usuario
 * @param {object|null} p.permisos      `null` = desconocido · `{}` = leído y vacío
 * @param {boolean} p.leyendoPermisos   hay una lectura en curso
 * @param {boolean} p.falloDePermisos   se agotaron los reintentos
 */
export function pantallaDeArranque({ cargando, autenticado, permisos, leyendoPermisos, falloDePermisos }) {
    if (cargando) return PANTALLA.SPLASH;
    // Sin usuario no hay permisos que esperar: manda el router (login).
    if (!autenticado) return PANTALLA.APP;
    if (falloDePermisos) return PANTALLA.ERROR_PERMISOS;
    if (leyendoPermisos || permisos === null) return PANTALLA.SPLASH;
    return PANTALLA.APP;
}
