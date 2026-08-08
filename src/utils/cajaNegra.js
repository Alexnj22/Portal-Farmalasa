// ── Caja negra — el registro que SOBREVIVE a la recarga ──────────────────────
//
// Existe por un bug que sólo pasa en el iPhone del usuario y que ningún emulador
// reproduce: al abrir el detalle de un producto «se recarga la página y se pone
// negro». Se persiguió tres veces por el lado del `backdrop-filter` y las tres
// falló, y el 2026-08-07 se comprobó por qué no podía ser eso: **su cuenta usa
// el tema `solid`, donde los cuatro `--backdrop-*` valen `none`**. O sea que en
// su teléfono nunca hubo desenfoque que romper.
//
// Cuando una hipótesis se cae tres veces, lo que falta no es otra hipótesis: es
// una medición del aparato donde pasa. El problema es que la página se RECARGA,
// así que la consola se limpia y no queda nada que mirar — y un teléfono no
// tiene consola a mano.
//
// `localStorage` sí sobrevive a la recarga. Esto es un anillo de 40 entradas que
// se escribe en los momentos que importan y se lee después en `/ios-test`, que
// el usuario puede abrir y fotografiar.
//
// **Por qué no se manda a la base:** el momento en que hay que anotar es
// justamente cuando la página se está por recargar; un `fetch` ahí no llega a
// salir. Primero se guarda local, que es síncrono y no puede fallar a medias.
//
// No guarda NADA de negocio: tipo de evento, mensaje de error, ruta y datos del
// aparato. La ruta puede traer el `?tab=`, que no es dato sensible.

const CLAVE = 'portal_caja_negra';
const TOPE  = 40;

// `localStorage` tira excepción en modo privado de Safari y cuando la cuota se
// llena. Una caja negra que rompe la app que viene a diagnosticar no sirve, así
// que todo acceso va envuelto y falla en silencio.
function leerCrudo() {
    try {
        const s = localStorage.getItem(CLAVE);
        const a = s ? JSON.parse(s) : [];
        return Array.isArray(a) ? a : [];
    } catch { return []; }
}

/**
 * Anota un evento. `detalle` es un objeto plano y chico — no meter payloads.
 * Devuelve la entrada escrita (o null) para poder encadenar sin leer de vuelta.
 */
export function anotar(tipo, detalle = {}) {
    try {
        const entrada = {
            t: new Date().toISOString(),
            tipo,
            ruta: `${location.pathname}${location.search}`,
            ...detalle,
        };
        const registro = leerCrudo();
        registro.push(entrada);
        // Se recorta por el principio: lo último es lo que explica la caída.
        localStorage.setItem(CLAVE, JSON.stringify(registro.slice(-TOPE)));
        return entrada;
    } catch { return null; }
}

export function leerCajaNegra() {
    return leerCrudo();
}

export function limpiarCajaNegra() {
    try { localStorage.removeItem(CLAVE); } catch { /* sin localStorage */ }
}

/**
 * Cómo está corriendo la app. Lo necesita el diagnóstico porque el modo
 * **standalone** es la diferencia grande contra cualquier emulador: iOS SUSPENDE
 * la app agregada a inicio en vez de recargarla, así que puede vivir días con el
 * bundle viejo (está escrito en `index.html`, donde por eso hay una recarga por
 * `visibilitychange`). Un chunk de ese bundle viejo ya no existe en el servidor.
 */
export function entorno() {
    const standalone = (window.matchMedia?.('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    return {
        standalone,
        nativo: !!(window.Capacitor?.isNativePlatform?.()),
        ua: navigator.userAgent,
        pantalla: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x`,
        memoria: navigator.deviceMemory ?? null,
        online: navigator.onLine,
    };
}
