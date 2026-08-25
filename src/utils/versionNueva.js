import { anotar } from './cajaNegra';

/**
 * «Hay una versión nueva» — el aviso que reemplazó a la recarga sola.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * El portal se publica varias veces al día. Cada publicación cambia el nombre
 * de los archivos de código, y los viejos dejan de existir en el servidor: el
 * navegador que tenía la pestaña abierta pide una pieza que ya no está y
 * `React.lazy` revienta. Hasta hoy el portal se RECARGABA solo en ese momento
 * —`main.jsx` y `ErrorBoundary`, las dos redes— y esa recarga se lleva todo lo
 * escrito y no guardado. El usuario lo describió exactamente así: «imagina que
 * se esté trabajando o llenando algo y se pierda por eso».
 *
 * Y había algo peor que el momento: el portal sólo se enteraba de la versión
 * nueva CUANDO YA HABÍA FALLADO. O sea que la recarga no era una precaución
 * sino un rescate tardío — para cuando ocurría, la persona ya estaba trabada.
 *
 * ── Qué hace ahora ────────────────────────────────────────────────────────
 * Pregunta, cada tanto y al volver a la pestaña, qué versión está publicada.
 * Si es otra, avisa. **Nunca recarga por su cuenta**: la recarga la decide la
 * persona, con el botón.
 *
 * ── Por qué se compara el ARCHIVO y no el número de versión ────────────────
 * Porque lo que rompe no es el número: es que el archivo con hash viejo ya no
 * exista. Dos publicaciones pueden llevar el mismo número (una republicación) y
 * romper igual, y el número puede subir sin que cambie nada servido. El archivo
 * de entrada es la verdad de qué bundle está sirviendo el servidor hoy. El
 * número viaja igual, pero sólo para poder nombrarlo en pantalla.
 *
 * ── El freno contra el bucle ──────────────────────────────────────────────
 * Si alguien aprieta «Actualizar» y la recarga NO trae el bundle nuevo (un
 * borde de CDN sirviendo todavía lo viejo), sin freno el aviso reaparecería al
 * instante y se convertiría en un botón que no hace nada, apretado en bucle.
 * Por eso se anota el objetivo antes de recargar: si al volver la entrada que
 * corre no es la que se pidió, el aviso se calla un rato y queda anotado.
 */

const ARCHIVO = '/version.json';

const CLAVE_OBJETIVO = 'portal_version_objetivo';
const CLAVE_INTENTO  = 'portal_version_intento';

const MIN_ENTRE_CONSULTAS_MS = 5 * 60 * 1000;
const CADA_MS                = 15 * 60 * 1000;
const ESPERA_TRAS_FALLIDO_MS = 10 * 60 * 1000;

/** Cuánto se calla el aviso cuando alguien elige «Ahora no». */
export const POSPONER_MS = 30 * 60 * 1000;

const leerSesion = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const escribirSesion = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* modo privado */ } };
const borrarSesion = (k) => { try { sessionStorage.removeItem(k); } catch { /* modo privado */ } };

/**
 * El archivo de código que está corriendo AHORA, leído del DOM.
 *
 * Es el `<script type="module">` que el build escribió en `index.html`. En
 * desarrollo no hay `/assets/`, así que devuelve `null` y toda la vigilancia
 * queda apagada sola — que es lo correcto: en `npm run dev` el bundle se
 * reemplaza en caliente y no hay nada que avisar.
 */
export function entradaQueCorre(doc = typeof document !== 'undefined' ? document : null) {
    const el = doc?.querySelector?.('script[type="module"][src*="/assets/"]');
    const src = el?.getAttribute?.('src') || '';
    return src.split('/').pop() || null;
}

/** ¿Lo publicado es otro bundle que el que corre? */
export function esOtraVersion(publicada, corriendo) {
    if (!publicada?.entrada || !corriendo) return false;
    return String(publicada.entrada).split('/').pop() !== corriendo;
}

/**
 * Qué versión está publicada. Devuelve `null` ante cualquier problema —sin red,
 * archivo ausente, JSON roto—: no saber no es lo mismo que haber una nueva, y
 * un aviso inventado enseña a ignorarlo.
 */
export async function consultarPublicada(fetchImpl) {
    const traer = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!traer) return null;
    try {
        // El parámetro además del `no-store`: el `no-store` manda sobre el caché
        // del navegador, no sobre un intermediario que ya respondió.
        const r = await traer(`${ARCHIVO}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r?.ok) return null;
        const d = await r.json();
        if (!d || typeof d.e !== 'string' || !d.e) return null;
        return { version: d.v ?? null, entrada: d.e };
    } catch { return null; }
}

// ── El estado, y quién lo escucha ────────────────────────────────────────────

// `callado` es un BOOLEANO y no una hora a propósito: si el componente tuviera
// que comparar `pospuestoHasta` contra el reloj, estaría leyendo la hora
// durante el render — impuro, y además no se despertaría solo cuando el plazo
// venciera. Acá el plazo lo cumple un temporizador que vuelve a avisar, y el
// componente sólo lee un sí o un no. `pospuestoHasta` se queda para poder
// mirarlo desde afuera.
let estado = { hay: false, bloqueado: false, degradado: false, callado: false, version: null, entrada: null, pospuestoHasta: 0 };
const oyentes = new Set();
let temporizadorPosponer = null;

const avisar = () => { for (const o of [...oyentes]) { try { o(estado); } catch { /* un oyente roto no calla a los otros */ } } };

export function leerEstadoVersion() { return estado; }

export function suscribirVersionNueva(fn) {
    oyentes.add(fn);
    fn(estado);
    return () => oyentes.delete(fn);
}

/**
 * El freno del bucle: si se pidió actualizar hace poco y la entrada que corre
 * sigue sin ser la que se pidió, la recarga no sirvió. Callarse un rato.
 */
function recargaQueNoTomo() {
    const intento = Number(leerSesion(CLAVE_INTENTO) || 0);
    if (!intento) return false;
    const objetivo = leerSesion(CLAVE_OBJETIVO);
    if (objetivo && objetivo === entradaQueCorre()) {
        // Llegó: se limpia para que el próximo aviso sea uno de verdad.
        borrarSesion(CLAVE_INTENTO);
        borrarSesion(CLAVE_OBJETIVO);
        return false;
    }
    return Date.now() - intento < ESPERA_TRAS_FALLIDO_MS;
}

/**
 * Hay una versión nueva. `bloqueado` significa que además YA falló algo por eso
 * —una pantalla que no abre—, o sea que no alcanza con la franja de aviso.
 *
 * Una vez marcado bloqueado no se vuelve atrás: la pantalla que no abrió sigue
 * sin abrir aunque después llegue una detección tranquila.
 */
export function marcarVersionNueva({ version = null, entrada = null, bloqueado = false } = {}) {
    if (!bloqueado && recargaQueNoTomo()) return;
    const yaEstaba = estado.hay && estado.bloqueado === (estado.bloqueado || bloqueado);
    estado = {
        hay: true,
        bloqueado: estado.bloqueado || bloqueado,
        version: version ?? estado.version,
        entrada: entrada ?? estado.entrada,
        // Un bloqueo cancela el «ahora no»: ya no es un aviso cortés, es la
        // explicación de por qué la pantalla no abrió.
        //
        // Pero `degradado` NO se revierte, y esa es la parte que se aprendió
        // mirándolo en producción. La primera versión volvía a subir el diálogo
        // ante cada bloqueo nuevo —«otra pantalla que no abre es información
        // nueva»—, y en un día de muchas publicaciones eso es un modal por
        // clic: con el bundle viejo, TODA vista que se abra por primera vez
        // falla igual. O sea que quien dijo «ahora no» lo tenía que volver a
        // decir en cada navegación, que es indistinguible de que el botón no
        // funcione. Dicho una vez, alcanza: la franja se queda en pantalla
        // diciendo lo mismo, y la recarga la sigue apretando una persona.
        degradado: estado.degradado,
        callado: bloqueado ? false : estado.callado,
        pospuestoHasta: bloqueado ? 0 : estado.pospuestoHasta,
    };
    if (!yaEstaba || bloqueado) {
        anotar('version-nueva', { version: estado.version, entrada: estado.entrada, bloqueado: estado.bloqueado });
    }
    avisar();
}

/**
 * «Ahora no». No se olvida: vuelve a aparecer.
 *
 * Son dos gestos distintos porque son dos avisos distintos:
 *
 *  · **Franja** — se calla un rato y el temporizador la trae de vuelta.
 *  · **Diálogo** (`bloqueado`) — **baja a franja y se queda ahí**. Callarlo por
 *    un rato no serviría de nada: `bloqueado` no se apaga solo, así que al
 *    vencer el plazo volvería el MISMO diálogo. Peor todavía era lo que hacía
 *    hasta hoy —el componente pintaba el diálogo antes de mirar `callado`—, o
 *    sea que «Ahora no» no cerraba nada y la única salida visible era
 *    actualizar. Reportado por el usuario: *«si le doy ahora no, no lo cierra,
 *    me obliga a actualizar siempre»*. Vuelve a subir a diálogo sólo si otra
 *    pantalla no abre.
 */
export function posponerAviso(ms = POSPONER_MS) {
    if (estado.bloqueado) {
        estado = { ...estado, degradado: true };
        avisar();
        return;
    }
    estado = { ...estado, callado: true, pospuestoHasta: Date.now() + ms };
    avisar();
    if (temporizadorPosponer) clearTimeout(temporizadorPosponer);
    temporizadorPosponer = setTimeout(() => {
        temporizadorPosponer = null;
        estado = { ...estado, callado: false, pospuestoHasta: 0 };
        avisar();
    }, ms);
}

/** La única recarga de esta familia, y la aprieta una persona. */
export function actualizarAhora() {
    escribirSesion(CLAVE_INTENTO, String(Date.now()));
    if (estado.entrada) escribirSesion(CLAVE_OBJETIVO, String(estado.entrada).split('/').pop());
    anotar('actualizar-a-mano', { version: estado.version, entrada: estado.entrada });
    window.location.reload();
}

// ── La vigilancia ────────────────────────────────────────────────────────────

let ultimaConsulta = 0;

/**
 * Una consulta, con piso entre consultas. `forzar` lo salta: lo usa el arranque,
 * donde el piso mediría contra una consulta que nunca hubo.
 */
export async function revisarVersion({ forzar = false, fetchImpl } = {}) {
    const corriendo = entradaQueCorre();
    if (!corriendo) return null;                 // desarrollo: no hay nada que comparar
    if (estado.hay) return null;                 // ya avisado: no se pregunta de nuevo
    const ahora = Date.now();
    if (!forzar && ahora - ultimaConsulta < MIN_ENTRE_CONSULTAS_MS) return null;
    ultimaConsulta = ahora;

    const publicada = await consultarPublicada(fetchImpl);
    if (!publicada) return null;
    if (!esOtraVersion(publicada, corriendo)) return publicada;
    marcarVersionNueva({ version: publicada.version, entrada: publicada.entrada });
    return publicada;
}

/**
 * Enciende la vigilancia. Dos disparadores y ninguno es un reloj rápido:
 *
 *  · **Al volver a la pestaña.** Es el momento natural —y el único que cubre a
 *    la app instalada en el teléfono, que iOS SUSPENDE en vez de recargar y
 *    puede quedarse días con el bundle viejo (era lo que resolvía la recarga a
 *    ciegas de los 30 minutos que esto reemplazó).
 *  · **Cada 15 minutos**, para la pantalla que se queda abierta todo el día
 *    —una tablet de sala, el tablero— y nunca pierde el foco.
 */
export function iniciarVigilanciaDeVersion() {
    if (!entradaQueCorre()) return () => {};

    const alVolver = () => { if (document.visibilityState === 'visible') revisarVersion(); };
    document.addEventListener('visibilitychange', alVolver);
    const reloj = setInterval(() => revisarVersion(), CADA_MS);
    revisarVersion({ forzar: true });

    return () => {
        document.removeEventListener('visibilitychange', alVolver);
        clearInterval(reloj);
    };
}

/** Sólo para las pruebas: deja el módulo como recién cargado. */
export function _reiniciarParaPruebas() {
    estado = { hay: false, bloqueado: false, degradado: false, callado: false, version: null, entrada: null, pospuestoHasta: 0 };
    ultimaConsulta = 0;
    if (temporizadorPosponer) { clearTimeout(temporizadorPosponer); temporizadorPosponer = null; }
    oyentes.clear();
    borrarSesion(CLAVE_INTENTO);
    borrarSesion(CLAVE_OBJETIVO);
}
