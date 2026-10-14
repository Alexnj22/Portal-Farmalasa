import * as almacen from '@plataforma/almacen';
const PREFIX = 'pedido_draft_';

export function saveDraft(key, data) {
    try { almacen.guardar(PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch { /* localStorage no disponible (privado/cuota) */ }
}

export function loadDraft(key) {
    try {
        const raw = almacen.leer(PREFIX + key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
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
        const { ts } = JSON.parse(raw);
        if (!ts || Date.now() - ts > 86_400_000) return null;
        return ts;
    } catch { return null; }
}

export function clearDraft(key) {
    try { almacen.borrar(PREFIX + key); } catch { /* localStorage no disponible (privado/cuota) */ }
}

/**
 * Borra TODOS los borradores de este dispositivo. Lo llama el cierre de sesión
 * —el botón, el vencimiento por inactividad, el cierre desde otra pestaña—.
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
