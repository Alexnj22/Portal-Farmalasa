// Las preguntas sobre la sesión que el portal y la app se hacen igual.
//
// Puras a propósito: no leen ni el navegador ni la red, así que las usa el
// `AuthContext` del portal y el de la app sin cambiar una línea, y se prueban
// solas (`tests/unit/sesionDelNavegador.test.js`).

/**
 * ¿Esta persona tiene que elegir su contraseña antes de entrar?
 *
 * La respuesta la pone el SERVIDOR en `app_metadata.cambio_de_clave`, que la
 * persona no puede escribir (sólo `service_role`; ver la migración
 * `guardia_cambio_de_contrasena`). Hasta el 2026-10-14 se decidía con
 * `user_metadata.must_change_password`, y ése lo reescribe cualquiera con
 * `updateUser({ data })` desde la consola del navegador: saltarse el cambio
 * obligatorio era una línea.
 *
 * Sólo `'primer_acceso'` obliga. `'temporal'` y `'definitiva'` son permisos de
 * escritura de un administrador, no un pedido a la persona.
 */
export const debeCambiarClave = (user) => user?.app_metadata?.cambio_de_clave === 'primer_acceso';

/**
 * ¿La cuenta es la de un carné de PAPEL? (`carne-<id>@staff.local`, la crea
 * `emitir-carne-temporal`). Es la única cuenta que puede vencer a mitad de la
 * sesión —el papel vale hasta medianoche— y por eso la única que hay que
 * volver a preguntarle al servidor en cada renovación del token.
 */
export const esCarneDePapel = (email) => {
    const e = String(email || '').toLowerCase();
    return e.startsWith('carne-') && e.endsWith('@staff.local');
};

const igual = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * ¿El perfil que acaba de llegar dice lo mismo que el que ya está puesto?
 *
 * Con «sí», quien llama conserva la referencia vieja: un `setUser` con un
 * objeto nuevo de datos idénticos vuelve a dibujar TODA la app, porque el
 * usuario está en el valor del contexto.
 *
 * Se miran las claves del perfil NUEVO. Las que sólo tiene el viejo las agregó
 * el navegador (`isSU`, que escribe `refreshPermissions`) y no cuentan. La foto
 * firmada cambia de URL sin cambiar de foto: si la cruda es la misma, es la
 * misma foto.
 */
export const mismoPerfil = (previo, nuevo) => {
    if (!previo || !nuevo) return false;
    return Object.keys(nuevo).every((k) => {
        if (k === 'photo' && nuevo.photoRaw && nuevo.photoRaw === previo.photoRaw) return true;
        return igual(previo[k], nuevo[k]);
    });
};

/**
 * ¿Dos mapas de permisos (`{ module_key: { can_view, can_edit, can_approve,
 * scope } }`) dicen lo mismo? Independiente del orden de las claves, que
 * depende del orden en que la base devolvió las filas.
 */
export const mismosPermisos = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => {
        const x = a[k], y = b[k];
        if (!x || !y) return x === y;
        return !!x.can_view === !!y.can_view
            && !!x.can_edit === !!y.can_edit
            && !!x.can_approve === !!y.can_approve
            && (x.scope ?? null) === (y.scope ?? null);
    });
};

/**
 * Los motivos de un login fallido que dicen «estas credenciales no sirven».
 * Sólo con éstos se descarta una credencial guardada (la biometría de la app):
 * un corte de red o un tope de intentos no dicen nada de la contraseña.
 */
export const MOTIVOS_DE_CREDENCIAL = new Set(['credenciales', 'bloqueado']);
export const esFalloDeCredencial = (resultado) => MOTIVOS_DE_CREDENCIAL.has(resultado?.motivo);

/**
 * ¿La ficha dice otro cargo u otra sala que el perfil que tiene puesto el
 * portal? Con «sí», hay que pedir el perfil completo: los permisos se cargan
 * según el cargo del perfil, así que con el perfil viejo la pantalla mostraría
 * los módulos del cargo anterior hasta recargar.
 *
 * `fila` es lo que trae `leerCargoYSalaPropios` (nombres de columna); `perfil`
 * es el usuario del contexto (`roleId`, `secondaryRoleId`, `branchId`). Sin
 * fila no hay cambio que afirmar.
 */
export function cambioDeCargoOSala(perfil, fila) {
    if (!perfil || !fila) return false;
    const n = (v) => (v === null || v === undefined || v === '' ? null : String(v));
    return n(perfil.roleId) !== n(fila.role_id)
        || n(perfil.secondaryRoleId) !== n(fila.secondary_role_id)
        || n(perfil.branchId) !== n(fila.branch_id);
}
