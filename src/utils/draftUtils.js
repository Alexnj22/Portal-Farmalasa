import * as almacen from '@plataforma/almacen';
const PREFIX = 'pedido_draft_';

/* ── El borrador tiene DUEÑO (2026-10-24) ─────────────────────────────────
 *
 * Antes no lo tenía, y por eso cerrar la sesión los borraba todos —incluido el
 * cierre por INACTIVIDAD, que es exactamente para lo que existen los borradores
 * (`useBorrador`: «la sesión se cierra sola y se pierde lo escrito»). Celina
 * daba de alta a una persona, la sesión venció, y al volver a entrar el alta
 * no estaba: la red de seguridad la quitaba el mismo evento que la hacía falta.
 *
 * Ahora cada borrador lleva el id de quien lo escribió. Al entrar,
 * `fijarDuenoDeBorradores` borra los que no son de esa persona —la que se
 * sienta después en esa computadora no encuentra lo de la anterior— y el cierre
 * por inactividad los deja. El botón «salir» sí los borra: ahí la persona se va
 * a propósito. */
let dueno = null;

export function fijarDuenoDeBorradores(id) {
    dueno = id ? String(id) : null;
    if (!dueno) return;
    try {
        almacen.claves()
            .filter((k) => k && k.startsWith(PREFIX))
            .forEach((k) => {
                let suyo = false;
                try { suyo = String(JSON.parse(almacen.leer(k))?.dueno ?? '') === dueno; } catch { /* corrupto: se va */ }
                if (!suyo) almacen.borrar(k);
            });
    } catch { /* localStorage no disponible (privado/cuota) */ }
}

// Un borrador de otra persona no existe para quien está adentro.
function ajeno(guardado) {
    return !!(dueno && guardado?.dueno && String(guardado.dueno) !== dueno);
}

export function saveDraft(key, data) {
    try { almacen.guardar(PREFIX + key, JSON.stringify({ ts: Date.now(), dueno, data })); } catch { /* localStorage no disponible (privado/cuota) */ }
}

export function loadDraft(key) {
    try {
        const raw = almacen.leer(PREFIX + key);
        if (!raw) return null;
        const guardado = JSON.parse(raw);
        if (ajeno(guardado)) return null;
        const { ts, data } = guardado;
        // Expire after 24 hours
        if (Date.now() - ts > 86_400_000) { clearDraft(key); return null; }
        return data;
    } catch { return null; }
}

/**
 * Cuándo se guardó el borrador, en milisegundos, o `null` si no hay.
 *
 * `loadDraft` se come el `ts` a propósito —quien repuebla no lo necesita— pero
 * un formulario que OFRECE recuperar en vez de reponer solo sí: lo que decide a
 * una persona no es «hay un borrador», es «hay uno de hace diez minutos». Sin la
 * hora, aceptar es una apuesta.
 *
 * Comparte la caducidad de 24 h: si ya venció, contesta `null` como `loadDraft`.
 */
export function loadDraftTime(key) {
    try {
        const raw = almacen.leer(PREFIX + key);
        if (!raw) return null;
        const guardado = JSON.parse(raw);
        if (ajeno(guardado)) return null;
        const { ts } = guardado;
        if (!ts || Date.now() - ts > 86_400_000) return null;
        return ts;
    } catch { return null; }
}

export function clearDraft(key) {
    try { almacen.borrar(PREFIX + key); } catch { /* localStorage no disponible (privado/cuota) */ }
}

/**
 * Borra TODOS los borradores de este dispositivo. Lo llama el botón «salir»:
 * el vencimiento por inactividad los conserva (ver `fijarDuenoDeBorradores`).
 *
 * Los borradores no llevan dueño en la clave: en una computadora de sala, el
 * que entra después de alguien se encontraba el pedido a medio escribir de la
 * persona anterior, ofrecido como si fuera suyo. Lo que se escribió y no se
 * guardó muere con la sesión que lo escribió.
 *
 * Sólo toca el prefijo de los borradores: las preferencias del equipo (tema,
 * impresora, filtros) viven en otras claves y no se van.
 */
export function borrarTodosLosBorradores() {
    try {
        almacen.claves()
            .filter((k) => k && k.startsWith(PREFIX))
            .forEach((k) => almacen.borrar(k));
    } catch { /* localStorage no disponible (privado/cuota) */ }
}
